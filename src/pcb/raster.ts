import type { Board, Layer, PlacedPad, Rect } from './types';

/**
 * Two-layer copper / keep-out rasters on a uniform grid.
 * keep[L][cell]: 0 = free, >0 = the only net whose (copper + clearance) covers the cell, -1 = hard obstacle / shared.
 * copper[L][cell]: net id of real copper (0 = none).
 */
export interface Raster {
  nx: number;
  ny: number;
  g: number;
  x0: number;
  y0: number;
  keep: Record<Layer, Int32Array>;
  copper: Record<Layer, Int32Array>;
  idx: (i: number, j: number) => number;
  cellOf: (x: number, y: number) => [number, number];
  centerOf: (i: number, j: number) => [number, number];
}

export const HARD = -1;

export const createRaster = (board: Board, g: number): Raster => {
  const nx = Math.ceil(board.w / g), ny = Math.ceil(board.h / g);
  const x0 = -board.w / 2, y0 = -board.h / 2;
  return {
    nx, ny, g, x0, y0,
    keep: { F: new Int32Array(nx * ny), B: new Int32Array(nx * ny) },
    copper: { F: new Int32Array(nx * ny), B: new Int32Array(nx * ny) },
    idx: (i, j) => j * nx + i,
    cellOf: (x, y) => [Math.floor((x - x0) / g), Math.floor((y - y0) / g)],
    centerOf: (i, j) => [x0 + (i + 0.5) * g, y0 + (j + 0.5) * g],
  };
};

const mergeOwner = (arr: Int32Array, k: number, id: number): void => {
  const cur = arr[k];
  if (cur === 0) arr[k] = id;
  else if (cur !== id) arr[k] = HARD;
};

/** Iterate cells whose center satisfies `inside(x, y)` within the bounding box. */
const forCells = (r: Raster, bx0: number, by0: number, bx1: number, by1: number, inside: (x: number, y: number) => boolean, fn: (k: number) => void): void => {
  const [i0, j0] = r.cellOf(bx0, by0);
  const [i1, j1] = r.cellOf(bx1, by1);
  for (let j = Math.max(0, j0); j <= Math.min(r.ny - 1, j1); j++) {
    for (let i = Math.max(0, i0); i <= Math.min(r.nx - 1, i1); i++) {
      const [x, y] = r.centerOf(i, j);
      if (inside(x, y)) fn(r.idx(i, j));
    }
  }
};

export type Shape =
  | { kind: 'rect'; x: number; y: number; w: number; h: number }
  | { kind: 'circle'; x: number; y: number; r: number }
  | { kind: 'seg'; x1: number; y1: number; x2: number; y2: number; hw: number };

const segDist = (px: number, py: number, x1: number, y1: number, x2: number, y2: number): number => {
  const dx = x2 - x1, dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
};

/** Distance from a point to the shape boundary (<= 0 inside). */
export const shapeDist = (s: Shape, x: number, y: number): number => {
  if (s.kind === 'circle') return Math.hypot(x - s.x, y - s.y) - s.r;
  if (s.kind === 'seg') return segDist(x, y, s.x1, s.y1, s.x2, s.y2) - s.hw;
  const dx = Math.max(s.x - x, 0, x - (s.x + s.w));
  const dy = Math.max(s.y - y, 0, y - (s.y + s.h));
  return Math.hypot(dx, dy);
};

const shapeBox = (s: Shape, grow: number): [number, number, number, number] => {
  if (s.kind === 'circle') return [s.x - s.r - grow, s.y - s.r - grow, s.x + s.r + grow, s.y + s.r + grow];
  if (s.kind === 'seg') return [Math.min(s.x1, s.x2) - s.hw - grow, Math.min(s.y1, s.y2) - s.hw - grow, Math.max(s.x1, s.x2) + s.hw + grow, Math.max(s.y1, s.y2) + s.hw + grow];
  return [s.x - grow, s.y - grow, s.x + s.w + grow, s.y + s.h + grow];
};

/** Stamp copper (owner id) and its clearance zone on a layer. */
export const stampShape = (r: Raster, layer: Layer, s: Shape, id: number, clearance: number): void => {
  const [bx0, by0, bx1, by1] = shapeBox(s, clearance + r.g);
  const keepGrow = clearance + r.g * 0.5;
  forCells(r, bx0, by0, bx1, by1, (x, y) => shapeDist(s, x, y) <= keepGrow, (k) => mergeOwner(r.keep[layer], k, id));
  forCells(r, bx0, by0, bx1, by1, (x, y) => shapeDist(s, x, y) <= 0, (k) => {
    if (r.copper[layer][k] === 0) r.copper[layer][k] = id;
  });
};

export const padShape = (p: PlacedPad): Shape =>
  p.shape === 'circle' ? { kind: 'circle', x: p.x, y: p.y, r: p.w / 2 } : { kind: 'rect', x: p.x - p.w / 2, y: p.y - p.h / 2, w: p.w, h: p.h };

export const rectShape = (rc: Rect): Shape => ({ kind: 'rect', ...rc });

/** Hard obstacles: board edge band (incl. rounded corners), NPTH holes, keep-out areas. */
export const stampBoardObstacles = (r: Raster, board: Board, edge: number, holes: Array<{ x: number; y: number; r: number }>, keepouts: Rect[]): void => {
  const hw = board.w / 2, hh = board.h / 2, cr = board.cornerRadius;
  for (let j = 0; j < r.ny; j++) {
    for (let i = 0; i < r.nx; i++) {
      const [x, y] = r.centerOf(i, j);
      let d = Math.min(hw - Math.abs(x), hh - Math.abs(y));
      const cx = Math.abs(x) - (hw - cr), cy = Math.abs(y) - (hh - cr);
      if (cx > 0 && cy > 0) d = Math.min(d, cr - Math.hypot(cx, cy));
      let hard = d < edge + r.g * 0.5;
      if (!hard) for (const h of holes) if (Math.hypot(x - h.x, y - h.y) < h.r + edge) { hard = true; break; }
      if (!hard) for (const k of keepouts) if (x >= k.x && x <= k.x + k.w && y >= k.y && y <= k.y + k.h) { hard = true; break; }
      if (hard) {
        const k = r.idx(i, j);
        r.keep.F[k] = HARD;
        r.keep.B[k] = HARD;
      }
    }
  }
};

/**
 * Squared Euclidean distance transform (Felzenszwalb & Huttenlocher) of a binary mask within a window.
 * Returns squared distance in cells to the nearest `true` cell (Infinity-like large value if none).
 */
export const edt2 = (mask: Uint8Array, w: number, h: number): Float32Array => {
  const INF = 1e12;
  const out = new Float32Array(w * h);
  const f = new Float64Array(Math.max(w, h));
  const d = new Float64Array(Math.max(w, h));
  const v = new Int32Array(Math.max(w, h));
  const z = new Float64Array(Math.max(w, h) + 1);
  const dt1 = (n: number): void => {
    let k = 0;
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;
    for (let q = 1; q < n; q++) {
      let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) {
        k--;
        s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
    }
  };
  // columns
  for (let i = 0; i < w; i++) {
    for (let j = 0; j < h; j++) f[j] = mask[j * w + i] ? 0 : INF;
    dt1(h);
    for (let j = 0; j < h; j++) out[j * w + i] = d[j];
  }
  // rows
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) f[i] = out[j * w + i];
    dt1(w);
    for (let i = 0; i < w; i++) out[j * w + i] = d[i];
  }
  return out;
};
