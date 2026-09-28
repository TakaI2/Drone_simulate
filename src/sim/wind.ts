import type { Vec3 } from '../core/math';
import { vAdd, vScale } from '../core/math';
import type { Rng } from '../core/rng';
import type { WindSpec } from '../core/types';

export interface WindModel {
  /** Advance gust state and return wind velocity (world) [m/s] at height z (profile applied if configured). */
  step: (dt: number, z?: number) => Vec3;
  current: () => Vec3;
}

/** Mean wind + first-order Gauss-Markov gusts per axis (vertical gust scaled down). */
export const createWind = (spec: WindSpec, rng: Rng, verticalScale = 0.3): WindModel => {
  const gust = { x: 0, y: 0, z: 0 };
  let value: Vec3 = { ...spec.mean };
  const step = (dt: number, z?: number): Vec3 => {
    if (spec.gustStd > 0) {
      const a = Math.exp(-dt / spec.gustTau);
      const s = spec.gustStd * Math.sqrt(1 - a * a);
      gust.x = a * gust.x + s * rng.gauss();
      gust.y = a * gust.y + s * rng.gauss();
      gust.z = a * gust.z + s * verticalScale * rng.gauss();
    }
    const pr = spec.profile;
    const k = pr && z !== undefined ? Math.pow(Math.max(z, pr.minHeight) / pr.refHeight, pr.exponent) : 1;
    value = k === 1 ? vAdd(spec.mean, gust) : vScale(vAdd(spec.mean, gust), k);
    return value;
  };
  return { step, current: () => value };
};
