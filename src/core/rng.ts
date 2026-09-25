/** Deterministic seeded RNG (mulberry32) + Gaussian (Box-Muller). */
export interface Rng {
  next: () => number;
  gauss: () => number;
}

export const createRng = (seed: number): Rng => {
  let s = seed >>> 0;
  let spare: number | null = null;
  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const gauss = (): number => {
    if (spare !== null) {
      const r = spare;
      spare = null;
      return r;
    }
    let u = 0;
    while (u <= 1e-12) u = next();
    const v = next();
    const mag = Math.sqrt(-2 * Math.log(u));
    spare = mag * Math.sin(2 * Math.PI * v);
    return mag * Math.cos(2 * Math.PI * v);
  };
  return { next, gauss };
};
