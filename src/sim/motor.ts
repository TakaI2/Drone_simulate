import type { MotorSpec, PropSpec } from '../core/types';

/** Rotor coefficients in rad/s units: T = kT w^2, Q = kQ w^2. */
export interface RotorCoefficients {
  kT: number;
  kQ: number;
}

export const rotorCoefficients = (prop: PropSpec, rho: number): RotorCoefficients => ({
  kT: (prop.ct * rho * prop.diameter ** 4) / (4 * Math.PI ** 2),
  kQ: (prop.cp * rho * prop.diameter ** 5) / (8 * Math.PI ** 3),
});

/** Speed constant in rad/s per volt. */
export const kvRad = (m: MotorSpec): number => (m.kv * 2 * Math.PI) / 60;

/**
 * Steady-state rotor speed for effective motor voltage ve:
 *   ve = w/Kv + R (I0 + kQ w^2 Kv)
 */
export const steadyOmega = (ve: number, m: MotorSpec, kQ: number): number => {
  const kv = kvRad(m);
  const a = m.resistance * kQ * kv;
  const b = 1 / kv;
  const c = m.resistance * m.noLoadCurrent - ve;
  if (c >= 0) return 0;
  const disc = b * b - 4 * a * c;
  return (-b + Math.sqrt(disc)) / (2 * a);
};

/** Effective motor voltage needed to hold rotor speed w in steady state. */
export const voltageForOmega = (w: number, m: MotorSpec, kQ: number): number => {
  if (w <= 0) return 0;
  const kv = kvRad(m);
  return w / kv + m.resistance * (m.noLoadCurrent + kQ * w * w * kv);
};

/** Steady-state motor current at speed w. */
export const steadyCurrent = (w: number, m: MotorSpec, kQ: number): number =>
  w > 0 ? m.noLoadCurrent + kQ * w * w * kvRad(m) : 0;

/** Instantaneous motor current from voltage balance (no regeneration through low-side switch + diode). */
export const motorCurrent = (ve: number, w: number, m: MotorSpec): number =>
  Math.max(0, (ve - w / kvRad(m)) / m.resistance);
