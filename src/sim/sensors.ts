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

export const createSensors = (spec: SensorSpec, rng: Rng, ideal = false): SensorModel => {
  const gyroBias = v3();
  const accelBias = v3(spec.accelBias * rng.gauss(), spec.accelBias * rng.gauss(), spec.accelBias * rng.gauss());
  const drift = { x: 0, y: 0 };
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
      pos = { x: s.p.x + n(spec.posStd) + (ideal ? 0 : drift.x), y: s.p.y + n(spec.posStd) + (ideal ? 0 : drift.y) };
      yaw = wrapPi(qToEuler(s.q).yaw + n(spec.yawStd));
    }
    let alt: number | null = null;
    if (altTimer >= 1 / spec.altRateHz - 1e-9) {
      altTimer = 0;
      alt = s.p.z + n(spec.altStd);
    }
    return { gyro, accel, pos, alt, yaw, vbat: s.batteryVoltage + n(spec.voltStd) };
  };
  return { read };
};
