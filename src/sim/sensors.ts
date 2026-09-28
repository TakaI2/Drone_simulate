import type { Vec3 } from '../core/math';
import { qRotateInv, qToEuler, v3, vAdd, wrapPi } from '../core/math';
import type { Rng } from '../core/rng';
import type { SensorSpec } from '../core/types';
import type { DroneState } from './dynamics';

export interface SensorReadings {
  gyro: Vec3;
  /** Specific force in body frame [m/s^2]. */
  accel: Vec3;
  /** Horizontal position (x,y) when a new sample is available. */
  pos: { x: number; y: number } | null;
  /** Altitude above ground when a new sample is available. */
  alt: number | null;
  /** Heading when a new sample is available. */
  yaw: number | null;
  vbat: number;
}

export interface SensorModel {
  read: (s: DroneState, gravity: number, dt: number) => SensorReadings;
}

/** Position-fix quality at a location: error scale and whether a fix is available (urban GNSS). */
export type FixQuality = (p: Vec3) => { scale: number; fix: boolean };

export const createSensors = (spec: SensorSpec, rng: Rng, ideal = false, quality?: FixQuality): SensorModel => {
  const gyroBias = v3();
  const accelBias = v3(spec.accelBias * rng.gauss(), spec.accelBias * rng.gauss(), spec.accelBias * rng.gauss());
  const drift = { x: 0, y: 0 };
  // Gauss-Markov errors start from their stationary distribution (no RNG draws when unused, so
  // existing scenarios keep their exact random sequence)
  const draw = (std: number | undefined): number => (std ? std * rng.gauss() : 0);
  const gm = { x: draw(spec.posBiasStd), y: draw(spec.posBiasStd), z: draw(spec.altBiasStd) };
  const gmStep = (v: number, std: number | undefined, tau: number | undefined, dt: number): number => {
    if (!std || !tau) return 0;
    const a = Math.exp(-dt / tau);
    return a * v + std * Math.sqrt(1 - a * a) * rng.gauss();
  };
  let posTimer = 0;
  let altTimer = 0;
  const n = (std: number): number => (ideal ? 0 : std * rng.gauss());

  const read = (s: DroneState, gravity: number, dt: number): SensorReadings => {
    if (!ideal) {
      const bw = spec.gyroBiasWalk * Math.sqrt(dt);
      gyroBias.x += bw * rng.gauss();
      gyroBias.y += bw * rng.gauss();
      gyroBias.z += bw * rng.gauss();
      const dw = spec.posDriftWalk * Math.sqrt(dt);
      drift.x += dw * rng.gauss();
      drift.y += dw * rng.gauss();
      gm.x = gmStep(gm.x, spec.posBiasStd, spec.posBiasTau, dt);
      gm.y = gmStep(gm.y, spec.posBiasStd, spec.posBiasTau, dt);
      gm.z = gmStep(gm.z, spec.altBiasStd, spec.altBiasTau, dt);
    }
    const gyro = ideal ? { ...s.w } : vAdd(s.w, v3(n(spec.gyroStd) + gyroBias.x, n(spec.gyroStd) + gyroBias.y, n(spec.gyroStd) + gyroBias.z));
    const f = qRotateInv(s.q, v3(s.accel.x, s.accel.y, s.accel.z + gravity));
    const accel = ideal ? f : vAdd(f, v3(n(spec.accelStd) + accelBias.x, n(spec.accelStd) + accelBias.y, n(spec.accelStd) + accelBias.z));

    posTimer += dt;
    altTimer += dt;
    let pos: SensorReadings['pos'] = null;
    let yaw: number | null = null;
    if (posTimer >= 1 / spec.posRateHz - 1e-9) {
      posTimer = 0;
      const q = quality && !ideal ? quality(s.p) : null;
      if (!q) pos = { x: s.p.x + n(spec.posStd) + (ideal ? 0 : drift.x + gm.x), y: s.p.y + n(spec.posStd) + (ideal ? 0 : drift.y + gm.y) };
      else {
        const ex = n(spec.posStd) + gm.x, ey = n(spec.posStd) + gm.y;
        pos = q.fix ? { x: s.p.x + q.scale * ex + drift.x, y: s.p.y + q.scale * ey + drift.y } : null;
      }
      yaw = wrapPi(qToEuler(s.q).yaw + n(spec.yawStd));
    }
    let alt: number | null = null;
    if (altTimer >= 1 / spec.altRateHz - 1e-9) {
      altTimer = 0;
      alt = s.p.z + n(spec.altStd) + (ideal ? 0 : gm.z);
    }
    return { gyro, accel, pos, alt, yaw, vbat: s.batteryVoltage + n(spec.voltStd) };
  };
  return { read };
};
