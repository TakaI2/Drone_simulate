import type { Vec3 } from '../core/math';
import { GNSS_URBAN } from '../core/presets';
import type { SkyMap } from '../core/types';
import type { FixQuality } from './sensors';

/** Open-sky fraction at p (bilinear in x/y, linear in height, clamped to the map). */
export const skyFractionAt = (m: SkyMap, p: Vec3): number => {
  const fx = Math.min(Math.max((p.x - m.x0) / m.spacing, 0), m.nx - 1);
  const fy = Math.min(Math.max((p.y - m.y0) / m.spacing, 0), m.ny - 1);
  const i0 = Math.min(Math.floor(fx), m.nx - 2 < 0 ? 0 : m.nx - 2), j0 = Math.min(Math.floor(fy), m.ny - 2 < 0 ? 0 : m.ny - 2);
  const tx = m.nx > 1 ? fx - i0 : 0, ty = m.ny > 1 ? fy - j0 : 0;
  const H = m.heights;
  let k0 = 0;
  while (k0 < H.length - 2 && p.z > H[k0 + 1]) k0++;
  const k1 = Math.min(k0 + 1, H.length - 1);
  const tz = k1 === k0 ? 0 : Math.min(Math.max((p.z - H[k0]) / (H[k1] - H[k0]), 0), 1);
  const at = (i: number, j: number, k: number): number => m.data[(k * m.ny + Math.min(j, m.ny - 1)) * m.nx + Math.min(i, m.nx - 1)];
  const layer = (k: number): number =>
    (1 - ty) * ((1 - tx) * at(i0, j0, k) + tx * at(i0 + 1, j0, k)) + ty * ((1 - tx) * at(i0, j0 + 1, k) + tx * at(i0 + 1, j0 + 1, k));
  return (1 - tz) * layer(k0) + tz * layer(k1);
};

/** Empirical urban GNSS model: error grows as the sky closes, no fix below fMin. */
export const gnssQualityFrom = (m: SkyMap, g: { gain: number; fMin: number } = GNSS_URBAN): FixQuality => (p) => {
  const f = skyFractionAt(m, p);
  return { scale: 1 + g.gain * (1 - f), fix: f >= g.fMin };
};
