import type { Quat, Vec3 } from '../core/math';
import { qIntegrate, qRotate, qRotateInv, qToEuler, v3, vAdd, vCross, vLen, vNorm, vScale, vSub, wrapPi } from '../core/math';
import type { SensorSpec } from '../core/types';
import type { DroneState } from './dynamics';
import type { SensorReadings } from './sensors';

export interface StateEstimate {
  p: Vec3;
  v: Vec3;
  q: Quat;
  w: Vec3;
  vbat: number;
}

export type EstimatorMode = 'truth' | 'filter';

export interface Estimator {
  update: (r: SensorReadings, truth: DroneState, dt: number) => StateEstimate;
  current: () => StateEstimate;
}

/** Filter tuning (fixed design constants of the estimator, not vehicle-specific). */
const TUNING = {
  mahonyKp: 1.0,
  mahonyKi: 0.05,
  yawGain: 1.5,
  accelLpfTau: 0.05,
  vbatLpfTau: 0.1,
  processAccelFloor: 0.3,
  processAccelScale: 3,
  /** Accel-bias random walk assumed by the filter [m/s^2/sqrt(s)]. */
  biasWalk: 0.02,
  /** Tilt correction from the horizontal accel-bias estimate [1/s] (aided INS). */
  tiltFromBiasGain: 0.5,
  /** Gyro-bias learning from the aided-INS tilt error [1/s^2]. */
  gyroBiasFromTilt: 0.05,
} as const;

/**
 * 3-state [p, v, accel-bias] Kalman filter per axis.
 * Prediction uses the measured world acceleration minus the estimated bias.
 */
const createAxisKf = (p0: number, sigmaA: number, sigmaBias: number, rMeas: number) => {
  const x = [p0, 0, 0];
  // covariance (symmetric 3x3, row-major)
  let P = [0.01, 0, 0, 0, 0.01, 0, 0, 0, 0.05];
  const predict = (aMeas: number, dt: number): void => {
    const a = aMeas - x[2];
    x[0] += x[1] * dt + 0.5 * a * dt * dt;
    x[1] += a * dt;
    const F = [1, dt, -0.5 * dt * dt, 0, 1, -dt, 0, 0, 1];
    // P = F P F^T + Q
    const FP = new Array<number>(9).fill(0);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) FP[i * 3 + j] += F[i * 3 + k] * P[k * 3 + j];
    const N = new Array<number>(9).fill(0);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) N[i * 3 + j] += FP[i * 3 + k] * F[j * 3 + k];
    const G = [0.5 * dt * dt, dt, 0];
    const qa = sigmaA * sigmaA;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) N[i * 3 + j] += G[i] * G[j] * qa;
    N[8] += sigmaBias * sigmaBias * dt;
    P = N;
  };
  const update = (z: number): void => {
    const sInn = P[0] + rMeas;
    const K = [P[0] / sInn, P[3] / sInn, P[6] / sInn];
    const y = z - x[0];
    for (let i = 0; i < 3; i++) x[i] += K[i] * y;
    const row0 = [P[0], P[1], P[2]];
    const N = [...P];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) N[i * 3 + j] = P[i * 3 + j] - K[i] * row0[j];
    P = N;
  };
  const shiftBias = (d: number): void => {
    x[2] += d;
  };
  return { predict, update, shiftBias, get: () => ({ p: x[0], v: x[1], b: x[2] }) };
};

export const createEstimator = (
  mode: EstimatorMode,
  spec: SensorSpec,
  gravity: number,
  init: DroneState,
): Estimator => {
  let est: StateEstimate = { p: { ...init.p }, v: v3(), q: { ...init.q }, w: v3(), vbat: init.batteryVoltage };
  const sigmaA = spec.accelStd * TUNING.processAccelScale + TUNING.processAccelFloor;
  const sigmaB = TUNING.biasWalk;
  const kx = createAxisKf(init.p.x, sigmaA, sigmaB, spec.posStd ** 2);
  const ky = createAxisKf(init.p.y, sigmaA, sigmaB, spec.posStd ** 2);
  const kz = createAxisKf(init.p.z, sigmaA, sigmaB, spec.altStd ** 2);
  let q = { ...init.q };
  let bias = v3();
  let accWorldLpf = v3();

  const update = (r: SensorReadings, truth: DroneState, dt: number): StateEstimate => {
    if (mode === 'truth') {
      est = { p: { ...truth.p }, v: { ...truth.v }, q: { ...truth.q }, w: { ...truth.w }, vbat: truth.batteryVoltage };
      return est;
    }
    // --- attitude: Mahony with acceleration compensation ---
    const fMeas = r.accel;
    const fExp = qRotateInv(q, v3(accWorldLpf.x, accWorldLpf.y, accWorldLpf.z + gravity));
    let corr = v3();
    if (vLen(fMeas) > 0.3 * gravity && vLen(fExp) > 0.3 * gravity) {
      const e = vCross(vNorm(fMeas), vNorm(fExp));
      bias = vSub(bias, vScale(e, TUNING.mahonyKi * dt));
      corr = vScale(e, TUNING.mahonyKp);
    }
    if (r.yaw !== null) {
      const eYaw = wrapPi(r.yaw - qToEuler(q).yaw);
      // heading arrives at posRateHz; spread the correction so the effective gain is yawGain [1/s]
      const rate = (TUNING.yawGain * eYaw) / (spec.posRateHz * dt);
      corr = vAdd(corr, qRotateInv(q, v3(0, 0, rate)));
    }
    const wCorr = vSub(r.gyro, bias);
    {
      // Aided INS tilt correction. A tilt error makes the rotated specific force show a fictitious
      // horizontal acceleration g*delta, which the position filter learns as accelerometer bias b.
      // Rotate the estimate by -k (z x b)/g (world frame) and hand the corrected part back to the filter.
      // (A gravity-only reference is unusable on multirotors: rotor drag puts horizontal force on the IMU.)
      const bx = kx.get().b, by = ky.get().b;
      const k = TUNING.tiltFromBiasGain;
      const tiltErr = qRotateInv(q, v3(by / gravity, -bx / gravity, 0));
      corr = vAdd(corr, vScale(tiltErr, k));
      // integral part: a persistent tilt correction means an uncompensated gyro bias
      bias = vSub(bias, vScale(tiltErr, TUNING.gyroBiasFromTilt * dt));
      kx.shiftBias(-k * bx * dt);
      ky.shiftBias(-k * by * dt);
    }
    q = qIntegrate(q, vAdd(wCorr, corr), dt);

    // --- translation: per-axis KF driven by world acceleration ---
    const aWorld = vSub(qRotate(q, fMeas), v3(0, 0, gravity));
    const al = Math.min(1, dt / TUNING.accelLpfTau);
    // accel-compensated reference for the Mahony term (tilt itself is corrected by the aided-INS term above)
    accWorldLpf = vAdd(accWorldLpf, vScale(vSub(aWorld, accWorldLpf), al));
    kx.predict(aWorld.x, dt);
    ky.predict(aWorld.y, dt);
    kz.predict(aWorld.z, dt);
    if (r.pos) {
      kx.update(r.pos.x);
      ky.update(r.pos.y);
    }
    if (r.alt !== null) kz.update(r.alt);
    const X = kx.get(), Y = ky.get(), Z = kz.get();
    const vl = Math.min(1, dt / TUNING.vbatLpfTau);
    est = {
      p: v3(X.p, Y.p, Z.p),
      v: v3(X.v, Y.v, Z.v),
      q,
      w: wCorr,
      vbat: est.vbat + (r.vbat - est.vbat) * vl,
    };
    return est;
  };
  return { update, current: () => est };
};
