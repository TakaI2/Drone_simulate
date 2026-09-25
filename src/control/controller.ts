import type { Quat, Vec3 } from '../core/math';
import {
  clamp,
  m3MulVec,
  qConj,
  qFromAxisAngle,
  qFromEuler,
  qFromTwoVectors,
  qMul,
  qRotate,
  qToEuler,
  v3,
  vAdd,
  vCross,
  vDot,
  vLen,
  vMul,
  vNorm,
  vScale,
  vSub,
} from '../core/math';
import type { DroneParams, EnvironmentSpec } from '../core/types';
import type { StateEstimate } from '../sim/estimator';
import type { RotorCoefficients } from '../sim/motor';
import { steadyOmega, voltageForOmega } from '../sim/motor';
import { createAllocator } from './allocation';
import type { Allocator } from './allocation';

export type Setpoint =
  | { kind: 'idle' }
  | { kind: 'position'; pos: Vec3; velFF: Vec3; accFF: Vec3; yaw: number }
  /** Manual "angle + altitude-hold" mode. */
  | { kind: 'manual'; roll: number; pitch: number; yawRate: number; climbRate: number };

export interface ControlOutput {
  /** PWM duty per rotor [0..1]. */
  u: number[];
  thrustCmd: number;
  attitudeSp: Quat;
  rateSp: Vec3;
  torqueCmd: Vec3;
  saturated: boolean;
}

export interface Controller {
  allocator: Allocator;
  update: (est: StateEstimate, sp: Setpoint, dt: number, landed: boolean) => ControlOutput;
  reset: () => void;
}

/** Low-pass cutoff for the velocity-loop D-term [Hz]. */
const VEL_D_CUTOFF_HZ = 10;

export const createController = (params: DroneParams, env: EnvironmentSpec, coeffs: RotorCoefficients[]): Controller => {
  const G = params.gains;
  const allocator = createAllocator(params.rotors, coeffs);
  const n = params.rotors.length;
  let velInt = v3();
  let rateInt = v3();
  let prevRate: Vec3 | null = null;
  let dTerm = v3();
  let manualYaw: number | null = null;
  let prevVel: Vec3 | null = null;
  let accLpf = v3();

  const reset = (): void => {
    velInt = v3();
    rateInt = v3();
    prevRate = null;
    dTerm = v3();
    manualYaw = null;
    prevVel = null;
    accLpf = v3();
  };

  /** Desired attitude from thrust vector direction and yaw. */
  const attitudeFromThrust = (fDir: Vec3, yaw: number): Quat => {
    const qYaw = qFromAxisAngle(v3(0, 0, 1), yaw);
    const qTilt = qFromTwoVectors(v3(0, 0, 1), fDir);
    return qMul(qTilt, qYaw);
  };

  const idleOutput = (est: StateEstimate): ControlOutput => ({
    u: new Array<number>(n).fill(0),
    thrustCmd: 0,
    attitudeSp: est.q,
    rateSp: v3(),
    torqueCmd: v3(),
    saturated: false,
  });

  const update = (est: StateEstimate, sp: Setpoint, dt: number, landed: boolean): ControlOutput => {
    if (sp.kind === 'idle') {
      reset();
      return idleOutput(est);
    }
    const m = params.mass;
    const g = env.gravity;
    let attSp: Quat;
    let thrust: number;
    let yawRateFF = 0;
    const bodyZ = qRotate(est.q, v3(0, 0, 1));

    if (sp.kind === 'position') {
      manualYaw = null;
      // --- position -> velocity ---
      const ep = vSub(sp.pos, est.p);
      let velSp = vAdd(vMul(G.posP, ep), sp.velFF);
      const hs = Math.hypot(velSp.x, velSp.y);
      if (hs > G.maxHorizSpeed) velSp = v3((velSp.x * G.maxHorizSpeed) / hs, (velSp.y * G.maxHorizSpeed) / hs, velSp.z);
      velSp = v3(velSp.x, velSp.y, clamp(velSp.z, -G.maxVertSpeed, G.maxVertSpeed));
      // --- velocity -> acceleration ---
      const ev = vSub(velSp, est.v);
      if (!landed) {
        velInt = vAdd(velInt, vScale(vMul(G.velI, ev), dt));
        const il = vLen(velInt);
        if (il > G.velIntLimit) velInt = vScale(velInt, G.velIntLimit / il);
      }
      // D-term on measured velocity (derivative-on-measurement avoids setpoint kicks), low-pass filtered
      const rawAcc = prevVel ? vScale(vSub(est.v, prevVel), 1 / dt) : v3();
      prevVel = est.v;
      const beta = 1 - Math.exp(-2 * Math.PI * VEL_D_CUTOFF_HZ * dt);
      accLpf = vAdd(accLpf, vScale(vSub(rawAcc, accLpf), beta));
      let acc = vSub(vAdd(vAdd(vMul(G.velP, ev), velInt), sp.accFF), vMul(G.velD, accLpf));
      const ah = Math.hypot(acc.x, acc.y);
      if (ah > G.maxHorizAccel) acc = v3((acc.x * G.maxHorizAccel) / ah, (acc.y * G.maxHorizAccel) / ah, acc.z);
      // --- acceleration -> thrust vector ---
      let F = vScale(v3(acc.x, acc.y, acc.z + g), m);
      F = v3(F.x, F.y, Math.max(F.z, 0.1 * m * g));
      const maxH = F.z * Math.tan(G.maxTiltRad);
      const fh = Math.hypot(F.x, F.y);
      if (fh > maxH) F = v3((F.x * maxH) / fh, (F.y * maxH) / fh, F.z);
      attSp = attitudeFromThrust(vNorm(F), sp.yaw);
      thrust = Math.max(0, vDot(F, bodyZ));
    } else {
      // --- manual: angle mode with altitude hold (climb-rate command) ---
      const yawNow = qToEuler(est.q).yaw;
      if (manualYaw === null) manualYaw = yawNow;
      manualYaw += sp.yawRate * dt;
      yawRateFF = sp.yawRate;
      const ev = clamp(sp.climbRate, -G.maxVertSpeed, G.maxVertSpeed) - est.v.z;
      if (!landed) velInt = v3(0, 0, clamp(velInt.z + G.velI.z * ev * dt, -G.velIntLimit, G.velIntLimit));
      const az = G.velP.z * ev + velInt.z;
      attSp = qFromEuler(clamp(sp.roll, -G.maxTiltRad, G.maxTiltRad), clamp(sp.pitch, -G.maxTiltRad, G.maxTiltRad), manualYaw);
      const cosTilt = Math.max(0.3, bodyZ.z);
      thrust = (m * (az + g)) / cosTilt;
    }

    // --- attitude -> body rates ---
    let qe = qMul(qConj(est.q), attSp);
    if (qe.w < 0) qe = { w: -qe.w, x: -qe.x, y: -qe.y, z: -qe.z };
    let rateSp = v3(2 * G.attP.x * qe.x, 2 * G.attP.y * qe.y, 2 * G.attP.z * qe.z + yawRateFF);
    rateSp = v3(clamp(rateSp.x, -G.maxRate.x, G.maxRate.x), clamp(rateSp.y, -G.maxRate.y, G.maxRate.y), clamp(rateSp.z, -G.maxRate.z, G.maxRate.z));

    // --- rate PID -> torque ---
    const er = vSub(rateSp, est.w);
    if (!landed) {
      rateInt = vAdd(rateInt, vScale(vMul(G.rateI, er), dt));
      rateInt = v3(clamp(rateInt.x, -G.rateIntLimit, G.rateIntLimit), clamp(rateInt.y, -G.rateIntLimit, G.rateIntLimit), clamp(rateInt.z, -G.rateIntLimit, G.rateIntLimit));
    } else {
      rateInt = v3();
    }
    const rawD = prevRate ? vScale(vSub(est.w, prevRate), -1 / dt) : v3();
    prevRate = est.w;
    const alpha = 1 - Math.exp(-2 * Math.PI * G.rateDCutoffHz * dt);
    dTerm = vAdd(dTerm, vScale(vSub(rawD, dTerm), alpha));
    const angAcc = vAdd(vAdd(vMul(G.rateP, er), rateInt), vMul(G.rateD, dTerm));
    const jw = m3MulVec(params.inertia, est.w);
    const torque = vAdd(m3MulVec(params.inertia, angAcc), vCross(est.w, jw));

    // --- allocation -> thrust per rotor -> PWM with battery compensation ---
    const vbat = Math.max(0.5, est.vbat);
    const fMax = params.rotors.map((r, i) => {
      const wmax = steadyOmega(vbat, r.motor, coeffs[i].kQ);
      return coeffs[i].kT * wmax * wmax;
    });
    const fMin = new Array<number>(n).fill(0);
    const { thrusts, saturated } = allocator.allocate({ thrust, tx: torque.x, ty: torque.y, tz: torque.z }, fMin, fMax);
    const u = thrusts.map((f, i) => {
      const w = Math.sqrt(Math.max(0, f) / coeffs[i].kT);
      return clamp(voltageForOmega(w, params.rotors[i].motor, coeffs[i].kQ) / vbat, 0, 1);
    });
    return { u, thrustCmd: thrust, attitudeSp: attSp, rateSp, torqueCmd: torque, saturated };
  };

  return { allocator, update, reset };
};
