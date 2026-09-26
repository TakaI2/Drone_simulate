import type { Raster } from './raster';
import type { DesignRules, Layer, PlacedPad, Rect, Via, Zone } from './types';

export interface PourResult {
  zones: Zone[];
  stitchVias: Via[];
  removedIslands: number;
  isolatedPads: string[];
  areaMm2: Record<Layer, number>;
  /** Kept pour masks (full raster), used for plane repair. */
  masks: Record<Layer, Uint8Array>;
  log: string[];
}

const LAYERS: Layer[] = ['F', 'B'];
/** Minimum pour feature (opening radius) in cells. */
const OPEN_CELLS = 2;

const erode = (m: Uint8Array, nx: number, ny: number, rad: number): Uint8Array => {
  // separable square erosion
  const tmp = new Uint8Array(nx * ny);
  const out = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      let ok = 1;
      for (let d = -rad; d <= rad && ok; d++) {
        const ii = i + d;
        if (ii < 0 || ii >= nx || !m[j * nx + ii]) ok = 0;
      }
      tmp[j * nx + i] = ok;
    }
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      let ok = 1;
      for (let d = -rad; d <= rad && ok; d++) {
        const jj = j + d;
        if (jj < 0 || jj >= ny || !tmp[jj * nx + i]) ok = 0;
      }
      out[j * nx + i] = ok;
    }
  return out;
};

const dilate = (m: Uint8Array, nx: number, ny: number, rad: number): Uint8Array => {
  const tmp = new Uint8Array(nx * ny);
  const out = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      let on = 0;
      for (let d = -rad; d <= rad && !on; d++) {
        const ii = i + d;
        if (ii >= 0 && ii < nx && m[j * nx + ii]) on = 1;
      }
      tmp[j * nx + i] = on;
    }
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      let on = 0;
      for (let d = -rad; d <= rad && !on; d++) {
        const jj = j + d;
        if (jj >= 0 && jj < ny && tmp[jj * nx + i]) on = 1;
      }
      out[j * nx + i] = on;
    }
  return out;
};

/** 4-connected component labels (0 = background). */
const label = (m: Uint8Array, nx: number, ny: number): { lab: Int32Array; count: number } => {
  const lab = new Int32Array(nx * ny);
  let count = 0;
  const stack: number[] = [];
  for (let k = 0; k < nx * ny; k++) {
    if (!m[k] || lab[k]) continue;
    count++;
    lab[k] = count;
    stack.push(k);
    while (stack.length) {
      const c = stack.pop() as number;
      const i = c % nx, j = (c - i) / nx;
      const nb = [i > 0 ? c - 1 : -1, i < nx - 1 ? c + 1 : -1, j > 0 ? c - nx : -1, j < ny - 1 ? c + nx : -1];
      for (const q of nb) if (q >= 0 && m[q] && !lab[q]) { lab[q] = count; stack.push(q); }
    }
  }
  return { lab, count };
};

/** Row runs merged vertically into rectangles. */
export const maskToRects = (m: Uint8Array, r: Raster): Rect[] => {
  const { nx, ny, g, x0, y0 } = r;
  const open = new Map<string, Rect>();
  const out: Rect[] = [];
  for (let j = 0; j < ny; j++) {
    const runs: Array<[number, number]> = [];
    let i = 0;
    while (i < nx) {
      if (m[j * nx + i]) {
        const s = i;
        while (i < nx && m[j * nx + i]) i++;
        runs.push([s, i - 1]);
      } else i++;
    }
    const next = new Map<string, Rect>();
    for (const [a, b] of runs) {
      const key = `${a}:${b}`;
      const prev = open.get(key);
      if (prev) {
        prev.h += g;
        next.set(key, prev);
        open.delete(key);
      } else {
        next.set(key, { x: x0 + a * g, y: y0 + j * g, w: (b - a + 1) * g, h: g });
      }
    }
    for (const rc of open.values()) out.push(rc);
    open.clear();
    for (const [k, v] of next) open.set(k, v);
  }
  for (const rc of open.values()) out.push(rc);
  return out;
};

export const pourGround = (
  r: Raster,
  gndId: number,
  rules: DesignRules,
  pads: PlacedPad[],
  vias: Via[],
  anchorPad: PlacedPad | null,
): PourResult => {
  const { nx, ny, g } = r;
  const log: string[] = [];
  const masks: Record<Layer, Uint8Array> = { F: new Uint8Array(0), B: new Uint8Array(0) };
  for (const L of LAYERS) {
    const allowed = new Uint8Array(nx * ny);
    for (let k = 0; k < nx * ny; k++) allowed[k] = r.keep[L][k] === 0 || r.keep[L][k] === gndId ? 1 : 0;
    const safe = erode(allowed, nx, ny, 1);
    const core = erode(safe, nx, ny, OPEN_CELLS);
    const opened = dilate(core, nx, ny, OPEN_CELLS);
    for (let k = 0; k < nx * ny; k++) opened[k] &= safe[k];
    // always keep real GND copper (pads/stubs) inside the pour region
    for (let k = 0; k < nx * ny; k++) if (r.copper[L][k] === gndId && safe[k]) opened[k] = 1;
    masks[L] = opened;
  }

  // ---------- stitching vias ----------
  const stitchVias: Via[] = [];
  const vr = rules.viaDiameter / 2;
  const rad = Math.ceil((vr + rules.clearance) / g);
  const pitch = Math.round(rules.stitchPitch / g);
  const existing = [...vias];
  for (let j = rad; j < ny - rad; j += pitch)
    for (let i = rad; i < nx - rad; i += pitch) {
      let ok = true;
      for (let dj = -rad; dj <= rad && ok; dj++)
        for (let di = -rad; di <= rad && ok; di++) {
          if (di * di + dj * dj > rad * rad) continue;
          const k = (j + dj) * nx + (i + di);
          for (const L of LAYERS) if (!masks[L][k] || r.copper[L][k] !== 0) ok = false;
        }
      if (!ok) continue;
      const [x, y] = r.centerOf(i, j);
      if (existing.some((v) => Math.hypot(v.x - x, v.y - y) < rules.viaDiameter + rules.clearance)) continue;
      const v: Via = { net: 'GND', x, y, d: rules.viaDiameter, drill: rules.viaDrill, kind: 'stitch' };
      stitchVias.push(v);
      existing.push(v);
    }

  // ---------- island removal ----------
  const labF = label(masks.F, nx, ny);
  const labB = label(masks.B, nx, ny);
  const parent = new Int32Array(labF.count + labB.count + 1).map((_, i) => i);
  const find = (a: number): number => (parent[a] === a ? a : (parent[a] = find(parent[a])));
  const union = (a: number, b: number): void => { parent[find(a)] = find(b); };
  const nodeF = (k: number): number => labF.lab[k];
  const nodeB = (k: number): number => (labB.lab[k] ? labF.count + labB.lab[k] : 0);
  const joinAt = (x: number, y: number): void => {
    const [i, j] = r.cellOf(x, y);
    if (i < 0 || j < 0 || i >= nx || j >= ny) return;
    const k = j * nx + i;
    const a = nodeF(k), b = nodeB(k);
    if (a && b) union(a, b);
  };
  for (const v of [...vias, ...stitchVias]) if (v.net === 'GND') joinAt(v.x, v.y);
  for (const p of pads) if (p.net === 'GND' && p.drill) joinAt(p.x, p.y);
  let root = 0;
  if (anchorPad) {
    const [i, j] = r.cellOf(anchorPad.x, anchorPad.y);
    const k = j * nx + i;
    root = nodeF(k) || nodeB(k);
  }
  let removed = 0;
  if (root) {
    const rootSet = find(root);
    const keepF = new Uint8Array(labF.count + 1), keepB = new Uint8Array(labB.count + 1);
    for (let c = 1; c <= labF.count; c++) keepF[c] = find(c) === rootSet ? 1 : 0;
    for (let c = 1; c <= labB.count; c++) keepB[c] = find(labF.count + c) === rootSet ? 1 : 0;
    removed = [...keepF.slice(1), ...keepB.slice(1)].filter((x) => !x).length;
    for (let k = 0; k < nx * ny; k++) {
      if (masks.F[k] && !keepF[labF.lab[k]]) masks.F[k] = 0;
      if (masks.B[k] && !keepB[labB.lab[k]]) masks.B[k] = 0;
    }
  }
  // stitching vias that ended up outside the kept pour are dropped
  const keptStitch = stitchVias.filter((v) => {
    const [i, j] = r.cellOf(v.x, v.y);
    const k = j * nx + i;
    return masks.F[k] && masks.B[k];
  });

  // ---------- isolated GND pads ----------
  const isolated: string[] = [];
  const allVias = [...vias, ...keptStitch].filter((v) => v.net === 'GND');
  for (const p of pads) {
    if (p.net !== 'GND') continue;
    // connected if any cell of the pad lies on kept pour, or a GND via inside the pad reaches kept pour
    const [i0, j0] = r.cellOf(p.x - p.w / 2, p.y - p.h / 2);
    const [i1, j1] = r.cellOf(p.x + p.w / 2, p.y + p.h / 2);
    let on = false;
    for (let j = Math.max(0, j0); j <= Math.min(ny - 1, j1) && !on; j++)
      for (let i = Math.max(0, i0); i <= Math.min(nx - 1, i1) && !on; i++) on = p.layers.some((L) => masks[L][j * nx + i] === 1);
    if (!on) {
      on = allVias.some((v) => {
        if (Math.abs(v.x - p.x) > p.w / 2 || Math.abs(v.y - p.y) > p.h / 2) return false;
        const [vi, vj] = r.cellOf(v.x, v.y);
        return masks.B[vj * nx + vi] === 1 || masks.F[vj * nx + vi] === 1;
      });
    }
    if (!on) isolated.push(`${p.ref}.${p.num}`);
  }

  const zones: Zone[] = LAYERS.map((L) => ({ net: 'GND', layer: L, rects: maskToRects(masks[L], r), kind: 'pour' as const }));
  const areaMm2 = { F: masks.F.reduce((s, v) => s + v, 0) * g * g, B: masks.B.reduce((s, v) => s + v, 0) * g * g };
  log.push(`GND ベタ: 上面 ${areaMm2.F.toFixed(0)} mm²、下面 ${areaMm2.B.toFixed(0)} mm²、スティッチングビア ${keptStitch.length} 個、孤島除去 ${removed}`);
  return { zones, stitchVias: keptStitch, removedIslands: removed, isolatedPads: isolated, areaMm2, masks, log };
};
