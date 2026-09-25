import type { Quat, Vec3 } from '../core/math';
import {
  m3Inverse,
  m3MulVec,
  qMul,
  qNorm,
  qRotate,
  qRotateInv,
  v3,
  vAdd,
  vCross,
  vLen,
  vScale,
  vSub,
} from '../core/math';
import type { DroneParams, EnvironmentSpec } from '../core/types';
import { dischargeSoc, terminalVoltage } from './battery';
import { motorCurrent, rotorCoefficients, steadyOmega } from './motor';
import type { RotorCoefficients } from './motor';

export interface RigidState {
  p: Vec3;
  v: Vec3;
  q: Quat;
  w: Vec3;
}

export interface DroneState extends RigidState {
  /** Rotor speeds [rad/s]. */
  rotorSpeed: number[];
  soc: number;
  batteryCurrent: number;
  batteryVoltage: number;
  /** World acceleration of last step (for accelerometer model). */
  accel: Vec3;
  onGround: boolean;
}

export interface StepDiagnostics {
  thrusts: number[];
  motorCurrents: number[];
  contactForce: number;
  /** Vertical speed at the moment of first ground contact (negative = downward). */
  impactSpeed: number | null;
}

export interface Dynamics {
  coeffs: RotorCoefficients[];
  /** Rotor speed that produces hover thrust at nominal conditions [rad/s]. */
  hoverOmega: number;
  initialState: (p: Vec3, yaw?: number) => DroneState;
  step: (s: DroneState, u: number[], wind: Vec3, dt: number) => { state: DroneState; diag: StepDiagnostics };
}

/** Ground contact model constants relative to vehicle weight. */
const GROUND = {
  /** Static compression of landing gear under weight [m]. */
  staticCompression: 0.002,
  dampingRatio: 0.8,
  /** Leveling stiffness and damping as multiples of (m g gearHeight). */
  levelStiffness: 4,
  levelDamping: 0.3,
} as const;

/** Cheeseman-Bennett ground effect with validity clamp. */
export const groundEffectFactor = (height: number, rotorRadius: number): number => {
  const h = Math.max(height, 0.6 * rotorRadius);
  const r = rotorRadius / (4 * h);
  return 1 / (1 - r * r);
};

export const createDynamics = (params: DroneParams, env: EnvironmentSpec): Dynamics => {
  const coeffs = params.rotors.map((r) => rotorCoefficients(r.prop, env.airDensity));
  const invJ = m3Inverse(params.inertia);
  const n = params.rotors.length;
  const hoverOmega = Math.sqrt((params.mass * env.gravity) / coeffs.reduce((s, c) => s + c.kT, 0));
  const kGround = (params.mass * env.gravity) / GROUND.staticCompression;
  const cGround = 2 * GROUND.dampingRatio * Math.sqrt(kGround * params.mass);

  const initialState = (p: Vec3, yaw = 0): DroneState => ({
    p: { ...p, z: p.z + params.gearHeight },
    v: v3(),
    q: { w: Math.cos(yaw / 2), x: 0, y: 0, z: Math.sin(yaw / 2) },
    w: v3(),
    rotorSpeed: new Array<number>(n).fill(0),
    soc: 1,
    batteryCurrent: 0,
    batteryVoltage: terminalVoltage(params.battery, 1, 0),
    accel: v3(),
    onGround: true,
  });

  /** Rigid-body derivative with rotor thrust/torque held constant over the step. */
  const derivative = (
    s: RigidState,
    bodyForce: Vec3,
    bodyTorque: Vec3,
    wind: Vec3,
    rotorSum: number,
  ): { dp: Vec3; dv: Vec3; dq: Quat; dw: Vec3; contact: number } => {
    // aerodynamic drag
    const vRel = vSub(s.v, wind);
    const speed = vLen(vRel);
    let force = vScale(vRel, -0.5 * env.airDensity * params.dragArea * speed);
    // rotor (induced) drag: horizontal in body frame, proportional to rotor speed
    const vRelBody = qRotateInv(s.q, vRel);
    const rd = (params.rotorDrag * rotorSum) / (hoverOmega * n);
    force = vAdd(force, qRotate(s.q, v3(-rd * vRelBody.x, -rd * vRelBody.y, 0)));
    // thrust
    force = vAdd(force, qRotate(s.q, bodyForce));
    // gravity
    force = vAdd(force, v3(0, 0, -params.mass * env.gravity));

    let torque = bodyTorque;
    let contact = 0;
    const penetration = params.gearHeight - s.p.z;
    if (penetration > 0) {
      contact = Math.max(0, kGround * penetration - cGround * s.v.z);
      const friction = Math.min(env.groundFriction * contact, params.mass * 20 * Math.hypot(s.v.x, s.v.y));
      const hv = Math.hypot(s.v.x, s.v.y);
      force = vAdd(force, v3(hv > 1e-6 ? (-friction * s.v.x) / hv : 0, hv > 1e-6 ? (-friction * s.v.y) / hv : 0, contact));
      // landing-gear leveling: legs push the frame back to level while in contact
      const up = qRotateInv(s.q, v3(0, 0, 1));
      const tiltAxis = vCross(v3(0, 0, 1), up); // body-frame axis rotating body z back toward world up
      const scale = params.mass * env.gravity * params.gearHeight;
      const levelK = GROUND.levelStiffness * scale * Math.min(1, contact / (params.mass * env.gravity));
      const levelC = GROUND.levelDamping * scale;
      torque = vAdd(torque, v3(levelK * tiltAxis.x - levelC * s.w.x, levelK * tiltAxis.y - levelC * s.w.y, -levelC * s.w.z));
    }

    const jw = m3MulVec(params.inertia, s.w);
    const dw = m3MulVec(invJ, vSub(torque, vCross(s.w, jw)));
    const dq = qMul(s.q, { w: 0, x: s.w.x / 2, y: s.w.y / 2, z: s.w.z / 2 });
    return { dp: s.v, dv: vScale(force, 1 / params.mass), dq, dw, contact };
  };

  const addState = (s: RigidState, d: { dp: Vec3; dv: Vec3; dq: Quat; dw: Vec3 }, h: number): RigidState => ({
    p: vAdd(s.p, vScale(d.dp, h)),
    v: vAdd(s.v, vScale(d.dv, h)),
    q: { w: s.q.w + d.dq.w * h, x: s.q.x + d.dq.x * h, y: s.q.y + d.dq.y * h, z: s.q.z + d.dq.z * h },
    w: vAdd(s.w, vScale(d.dw, h)),
  });

  const step = (s: DroneState, u: number[], wind: Vec3, dt: number) => {
    const vbat = terminalVoltage(params.battery, s.soc, s.batteryCurrent);
    const rotorSpeed: number[] = [];
    const thrusts: number[] = [];
    const motorCurrents: number[] = [];
    let batteryCurrent = 0;
    let fz = 0;
    let torque = v3();
    let rotorSum = 0;
    const heightAgl = s.p.z; // ground plane at z=0
    for (let i = 0; i < n; i++) {
      const rotor = params.rotors[i];
      const c = coeffs[i];
      const ui = Math.min(1, Math.max(0, u[i] ?? 0));
      const ve = ui * vbat;
      const wss = steadyOmega(ve, rotor.motor, c.kQ);
      const a = Math.exp(-dt / rotor.motor.timeConstant);
      const wi = wss + (s.rotorSpeed[i] - wss) * a;
      rotorSpeed.push(wi);
      rotorSum += wi;
      const im = motorCurrent(ve, wi, rotor.motor);
      motorCurrents.push(im);
      batteryCurrent += ui * im;
      const ge = groundEffectFactor(heightAgl + rotor.position.z, rotor.prop.diameter / 2);
      const t = c.kT * wi * wi * ge;
      thrusts.push(t);
      fz += t;
      const arm = vCross(rotor.position, v3(0, 0, t));
      torque = vAdd(torque, v3(arm.x, arm.y, arm.z - rotor.spin * c.kQ * wi * wi));
    }
    const bodyForce = v3(0, 0, fz);

    // RK4 on rigid body
    const k1 = derivative(s, bodyForce, torque, wind, rotorSum);
    const k2 = derivative(addState(s, k1, dt / 2), bodyForce, torque, wind, rotorSum);
    const k3 = derivative(addState(s, k2, dt / 2), bodyForce, torque, wind, rotorSum);
    const k4 = derivative(addState(s, k3, dt), bodyForce, torque, wind, rotorSum);
    const comb = <T extends Vec3>(a: T, b: T, c: T, d: T): Vec3 => vScale(vAdd(vAdd(a, vScale(vAdd(b, c), 2)), d), dt / 6);
    const p = vAdd(s.p, comb(k1.dp, k2.dp, k3.dp, k4.dp));
    const dv = comb(k1.dv, k2.dv, k3.dv, k4.dv);
    const v = vAdd(s.v, dv);
    const w = vAdd(s.w, comb(k1.dw, k2.dw, k3.dw, k4.dw));
    const q = qNorm({
      w: s.q.w + (dt / 6) * (k1.dq.w + 2 * k2.dq.w + 2 * k3.dq.w + k4.dq.w),
      x: s.q.x + (dt / 6) * (k1.dq.x + 2 * k2.dq.x + 2 * k3.dq.x + k4.dq.x),
      y: s.q.y + (dt / 6) * (k1.dq.y + 2 * k2.dq.y + 2 * k3.dq.y + k4.dq.y),
      z: s.q.z + (dt / 6) * (k1.dq.z + 2 * k2.dq.z + 2 * k3.dq.z + k4.dq.z),
    });
    const onGround = p.z <= params.gearHeight + 1e-4;
    const impactSpeed = !s.onGround && onGround ? s.v.z : null;
    const state: DroneState = {
      p,
      v,
      q,
      w,
      rotorSpeed,
      soc: dischargeSoc(params.battery, s.soc, batteryCurrent, dt),
      batteryCurrent,
      batteryVoltage: terminalVoltage(params.battery, s.soc, batteryCurrent),
      accel: vScale(dv, 1 / dt),
      onGround,
    };
    return { state, diag: { thrusts, motorCurrents, contactForce: k1.contact, impactSpeed } };
  };

  return { coeffs, hoverOmega, initialState, step };
};
