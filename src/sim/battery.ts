import type { BatterySpec } from '../core/types';

/** Typical LiPo open-circuit voltage per cell vs state of charge (0..1). */
const LIPO_OCV: ReadonlyArray<readonly [number, number]> = [
  [0.0, 3.27],
  [0.05, 3.5],
  [0.1, 3.61],
  [0.2, 3.69],
  [0.3, 3.73],
  [0.4, 3.77],
  [0.5, 3.8],
  [0.6, 3.84],
  [0.7, 3.89],
  [0.8, 3.97],
  [0.9, 4.06],
  [1.0, 4.2],
];

export const cellOcv = (soc: number): number => {
  const s = Math.min(1, Math.max(0, soc));
  for (let i = 1; i < LIPO_OCV.length; i++) {
    const [s1, v1] = LIPO_OCV[i];
    if (s <= s1) {
      const [s0, v0] = LIPO_OCV[i - 1];
      return v0 + ((v1 - v0) * (s - s0)) / (s1 - s0);
    }
  }
  return LIPO_OCV[LIPO_OCV.length - 1][1];
};

export const terminalVoltage = (b: BatterySpec, soc: number, current: number): number =>
  Math.max(0, b.cells * cellOcv(soc) - b.internalResistance * current);

/** Coulomb counting. */
export const dischargeSoc = (b: BatterySpec, soc: number, current: number, dt: number): number =>
  Math.max(0, soc - (current * dt) / (b.capacityAh * 3600));
