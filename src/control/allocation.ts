import type { Matrix } from '../core/math';
import { matDet, matMul, matPinvRight, matT, matVec } from '../core/math';
import type { RotorSpec } from '../core/types';
import type { RotorCoefficients } from '../sim/motor';

/** Wrench command: collective thrust [N] and body torques [N m]. */
export interface Wrench {
  thrust: number;
  tx: number;
  ty: number;
  tz: number;
}

export interface Allocator {
  /** 4 x N effectiveness matrix. */
  B: Matrix;
  /** N x 4 pseudo-inverse (null if uncontrollable). */
  pinv: Matrix | null;
  controllable: boolean;
  /** Normalised determinant of B B^T; small -> poorly conditioned layout. */
  conditioning: number;
  /** Returns per-rotor thrusts within [fMin, fMax] (priority: roll/pitch > yaw > collective). */
  allocate: (w: Wrench, fMin: number[], fMax: number[]) => { thrusts: number[]; saturated: boolean };
}

/** Column i = (1, y_i, -x_i, -spin_i * kQ_i / kT_i). */
export const effectivenessMatrix = (rotors: RotorSpec[], coeffs: RotorCoefficients[]): Matrix => {
  const cols = rotors.map((r, i) => [1, r.position.y, -r.position.x, (-r.spin * coeffs[i].kQ) / coeffs[i].kT]);
  return matT(cols);
};

const BISECT_ITERS = 14;

export const createAllocator = (rotors: RotorSpec[], coeffs: RotorCoefficients[]): Allocator => {
  const B = effectivenessMatrix(rotors, coeffs);
  const n = rotors.length;
  // normalise rows by their scale so the conditioning metric is dimensionless
  const rowScale = B.map((row) => Math.max(...row.map((x) => Math.abs(x)), 1e-12));
  const Bn = B.map((row, i) => row.map((x) => x / rowScale[i]));
  const gram = matMul(Bn, matT(Bn));
  const conditioning = n >= 4 ? matDet(gram) / Math.pow(n, 4) : 0;
  const controllable = n >= 4 && conditioning > 1e-6;
  const pinv = controllable ? matPinvRight(B) : null;

  const allocate = (w: Wrench, fMin: number[], fMax: number[]) => {
    if (!pinv) return { thrusts: new Array<number>(n).fill(0), saturated: true };
    const thrustCol = pinv.map((row) => row[0]);
    /** Try to realise torques with a collective shift; returns thrusts or null if infeasible. */
    const fit = (tx: number, ty: number, tz: number): number[] | null => {
      const f0 = matVec(pinv, [w.thrust, tx, ty, tz]);
      let lo = -Infinity, hi = Infinity;
      for (let i = 0; i < n; i++) {
        const c = thrustCol[i];
        if (Math.abs(c) < 1e-12) {
          if (f0[i] < fMin[i] - 1e-9 || f0[i] > fMax[i] + 1e-9) return null;
          continue;
        }
        const a = (fMin[i] - f0[i]) / c, b = (fMax[i] - f0[i]) / c;
        lo = Math.max(lo, Math.min(a, b));
        hi = Math.min(hi, Math.max(a, b));
      }
      if (lo > hi + 1e-12) return null;
      const d = Math.min(Math.max(0, lo), hi);
      return f0.map((f, i) => f + d * thrustCol[i]);
    };
    const full = fit(w.tx, w.ty, w.tz);
    if (full) {
      const nominal = matVec(pinv, [w.thrust, w.tx, w.ty, w.tz]);
      const exact = full.every((f, i) => Math.abs(f - nominal[i]) < 1e-9);
      return { thrusts: full, saturated: !exact };
    }
    // reduce yaw first
    let best: number[] | null = fit(w.tx, w.ty, 0);
    if (best) {
      let a = 0, b = 1;
      for (let k = 0; k < BISECT_ITERS; k++) {
        const m = (a + b) / 2;
        const f = fit(w.tx, w.ty, w.tz * m);
        if (f) { a = m; best = f; } else b = m;
      }
      return { thrusts: best, saturated: true };
    }
    // then roll/pitch
    let a = 0, b = 1;
    best = fit(0, 0, 0);
    for (let k = 0; k < BISECT_ITERS; k++) {
      const m = (a + b) / 2;
      const f = fit(w.tx * m, w.ty * m, 0);
      if (f) { a = m; best = f; } else b = m;
    }
    const raw = best ?? matVec(pinv, [w.thrust, 0, 0, 0]);
    return { thrusts: raw.map((f, i) => Math.min(fMax[i], Math.max(fMin[i], f))), saturated: true };
  };

  return { B, pinv, controllable, conditioning, allocate };
};
