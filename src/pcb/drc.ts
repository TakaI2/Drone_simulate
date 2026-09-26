import { rectRectDist, segRectDist, segSegDist, pointSegDist } from './geometry';
import type { Layer, PcbDesign, Rect } from './types';

type Geo =
  | { kind: 'rect'; r: Rect }
  | { kind: 'circle'; x: number; y: number; rad: number }
  | { kind: 'seg'; x1: number; y1: number; x2: number; y2: number; hw: number };

interface Obj {
  id: number;
  net: string;
  layers: Layer[];
  geo: Geo;
  label: string;
  isPad: boolean;
}

export interface DrcViolation {
  kind: 'clearance' | 'edge' | 'drill' | 'annular' | 'width' | 'hole-to-hole' | 'unconnected';
  detail: string;
  x: number;
  y: number;
}

export interface DrcResult {
  violations: DrcViolation[];
  counts: Record<DrcViolation['kind'], number>;
  unconnectedNets: string[];
  checkedPairs: number;
  objects: number;
}

const bbox = (g: Geo): Rect => {
  if (g.kind === 'rect') return g.r;
  if (g.kind === 'circle') return { x: g.x - g.rad, y: g.y - g.rad, w: 2 * g.rad, h: 2 * g.rad };
  const x0 = Math.min(g.x1, g.x2) - g.hw, y0 = Math.min(g.y1, g.y2) - g.hw;
  return { x: x0, y: y0, w: Math.abs(g.x2 - g.x1) + 2 * g.hw, h: Math.abs(g.y2 - g.y1) + 2 * g.hw };
};

/** Signed-ish gap between two copper shapes (<= 0 means touching/overlapping). */
export const gap = (a: Geo, b: Geo): number => {
  if (a.kind === 'rect' && b.kind === 'rect') return rectRectDist(a.r, b.r) > 0 ? rectRectDist(a.r, b.r) : -1e-9;
  if (a.kind === 'circle' && b.kind === 'circle') return Math.hypot(a.x - b.x, a.y - b.y) - a.rad - b.rad;
  if (a.kind === 'seg' && b.kind === 'seg') return segSegDist(a.x1, a.y1, a.x2, a.y2, b.x1, b.y1, b.x2, b.y2) - a.hw - b.hw;
  if (a.kind === 'rect' && b.kind === 'circle') {
    const dx = Math.max(a.r.x - b.x, 0, b.x - (a.r.x + a.r.w)), dy = Math.max(a.r.y - b.y, 0, b.y - (a.r.y + a.r.h));
    return Math.hypot(dx, dy) - b.rad;
  }
  if (a.kind === 'circle' && b.kind === 'rect') return gap(b, a);
  if (a.kind === 'rect' && b.kind === 'seg') return segRectDist(b.x1, b.y1, b.x2, b.y2, a.r) - b.hw;
  if (a.kind === 'seg' && b.kind === 'rect') return gap(b, a);
  if (a.kind === 'circle' && b.kind === 'seg') return pointSegDist(a.x, a.y, b.x1, b.y1, b.x2, b.y2) - a.rad - b.hw;
  if (a.kind === 'seg' && b.kind === 'circle') return gap(b, a);
  return Infinity;
};

const CELL = 1.0;
const TOL = 1e-3;

export const runDrc = (d: PcbDesign): DrcResult => {
  const R = d.rules;
  const objs: Obj[] = [];
  let id = 0;
  let ncCounter = 0;
  for (const p of d.pads) {
    if (p.npth) continue;
    const net = p.net ?? `__nc${ncCounter++}`;
    const geo: Geo = p.shape === 'circle' ? { kind: 'circle', x: p.x, y: p.y, rad: p.w / 2 } : { kind: 'rect', r: { x: p.x - p.w / 2, y: p.y - p.h / 2, w: p.w, h: p.h } };
    objs.push({ id: id++, net, layers: p.layers, geo, label: `${p.ref}.${p.num}`, isPad: true });
  }
  for (const t of d.tracks) objs.push({ id: id++, net: t.net, layers: [t.layer], geo: { kind: 'seg', x1: t.x1, y1: t.y1, x2: t.x2, y2: t.y2, hw: t.width / 2 }, label: `track(${t.net})`, isPad: false });
  for (const v of d.vias) objs.push({ id: id++, net: v.net, layers: ['F', 'B'], geo: { kind: 'circle', x: v.x, y: v.y, rad: v.d / 2 }, label: `via(${v.net})`, isPad: false });
  for (const z of d.zones) for (const rc of z.rects) objs.push({ id: id++, net: z.net, layers: [z.layer], geo: { kind: 'rect', r: rc }, label: `${z.kind}(${z.net})`, isPad: false });

  // spatial hash
  const hash = new Map<string, number[]>();
  const keyOf = (i: number, j: number): string => `${i},${j}`;
  for (const o of objs) {
    const b = bbox(o.geo);
    for (let i = Math.floor((b.x - R.clearance) / CELL); i <= Math.floor((b.x + b.w + R.clearance) / CELL); i++)
      for (let j = Math.floor((b.y - R.clearance) / CELL); j <= Math.floor((b.y + b.h + R.clearance) / CELL); j++) {
        const k = keyOf(i, j);
        if (!hash.has(k)) hash.set(k, []);
        hash.get(k)!.push(o.id);
      }
  }
  const violations: DrcViolation[] = [];
  const seen = new Set<number>();
  // union-find for connectivity
  const parent = objs.map((_, i) => i);
  const find = (a: number): number => (parent[a] === a ? a : (parent[a] = find(parent[a])));
  let pairs = 0;
  for (const bucket of hash.values()) {
    for (let x = 0; x < bucket.length; x++)
      for (let y = x + 1; y < bucket.length; y++) {
        const a = objs[bucket[x]], b = objs[bucket[y]];
        const pk = a.id < b.id ? a.id * 1_000_003 + b.id : b.id * 1_000_003 + a.id;
        if (seen.has(pk)) continue;
        seen.add(pk);
        if (!a.layers.some((L) => b.layers.includes(L))) continue;
        pairs++;
        const gp = gap(a.geo, b.geo);
        if (a.net === b.net) {
          if (gp <= TOL) parent[find(a.id)] = find(b.id);
          continue;
        }
        if (gp < R.clearance - TOL) {
          const bb = bbox(a.geo);
          if (violations.filter((v) => v.kind === 'clearance').length < 500)
            violations.push({ kind: 'clearance', detail: `${a.label} ↔ ${b.label}: ${Math.max(0, gp).toFixed(3)} mm < ${R.clearance} mm`, x: bb.x + bb.w / 2, y: bb.y + bb.h / 2 });
          else violations.push({ kind: 'clearance', detail: '…', x: 0, y: 0 });
        }
      }
  }

  // edge clearance (rounded rectangle)
  const hw = d.board.w / 2, hh = d.board.h / 2, cr = d.board.cornerRadius;
  const insideBoard = (x: number, y: number, m: number): boolean => {
    if (Math.abs(x) > hw - m || Math.abs(y) > hh - m) return false;
    const cx = Math.abs(x) - (hw - cr), cy = Math.abs(y) - (hh - cr);
    return !(cx > 0 && cy > 0 && Math.hypot(cx, cy) > cr - m);
  };
  for (const o of objs) {
    const b = bbox(o.geo);
    const corners: Array<[number, number]> = [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]];
    // rectangles of pour are cut by the raster edge band; check all corners
    if (!corners.every(([x, y]) => insideBoard(x, y, R.edgeClearance - TOL))) {
      violations.push({ kind: 'edge', detail: `${o.label} が基板端から ${R.edgeClearance} mm 未満`, x: b.x, y: b.y });
    }
  }

  // drills / annular / width
  const holes: Array<{ x: number; y: number; r: number; label: string }> = [];
  for (const v of d.vias) {
    if (v.drill < R.minDrill - TOL) violations.push({ kind: 'drill', detail: `ビア穴径 ${v.drill} < ${R.minDrill}`, x: v.x, y: v.y });
    if ((v.d - v.drill) / 2 < R.minAnnularRing - TOL) violations.push({ kind: 'annular', detail: `ビアのアニュラリング ${((v.d - v.drill) / 2).toFixed(3)} < ${R.minAnnularRing}`, x: v.x, y: v.y });
    holes.push({ x: v.x, y: v.y, r: v.drill / 2, label: 'via' });
  }
  for (const p of d.pads) {
    if (!p.drill) continue;
    if (!p.npth && (Math.min(p.w, p.h) - p.drill) / 2 < R.minAnnularRing - TOL) violations.push({ kind: 'annular', detail: `${p.ref}.${p.num} のアニュラリング不足`, x: p.x, y: p.y });
    holes.push({ x: p.x, y: p.y, r: p.drill / 2, label: `${p.ref}.${p.num}` });
  }
  for (let i = 0; i < holes.length; i++)
    for (let j = i + 1; j < holes.length; j++) {
      const a = holes[i], b = holes[j];
      const dd = Math.hypot(a.x - b.x, a.y - b.y) - a.r - b.r;
      if (dd < 0.25 - TOL) violations.push({ kind: 'hole-to-hole', detail: `${a.label} ↔ ${b.label}: 穴間 ${dd.toFixed(3)} mm < 0.25 mm`, x: a.x, y: a.y });
    }
  for (const t of d.tracks) if (t.width < R.minTrack - TOL) violations.push({ kind: 'width', detail: `線幅 ${t.width} < ${R.minTrack}`, x: t.x1, y: t.y1 });

  // connectivity per net
  const unconnected: string[] = [];
  const nets = new Set(objs.filter((o) => o.isPad && !o.net.startsWith('__nc')).map((o) => o.net));
  for (const n of nets) {
    const padsN = objs.filter((o) => o.isPad && o.net === n);
    const groups = new Map<number, string[]>();
    for (const o of padsN) {
      const k = find(o.id);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(o.label);
    }
    if (groups.size > 1) {
      unconnected.push(n);
      const sorted = [...groups.values()].sort((a, b) => b.length - a.length);
      violations.push({ kind: 'unconnected', detail: `${n}: ${groups.size} 群に分断（主群 ${sorted[0].length} ピン、孤立: ${sorted.slice(1).map((g) => g.join('+')).join(' / ')}）`, x: 0, y: 0 });
    }
  }
  const counts = { clearance: 0, edge: 0, drill: 0, annular: 0, width: 0, 'hole-to-hole': 0, unconnected: 0 } as Record<DrcViolation['kind'], number>;
  for (const v of violations) counts[v.kind]++;
  return { violations, counts, unconnectedNets: unconnected, checkedPairs: pairs, objects: objs.length };
};
