import type { Circuit, NetClass } from '../electrical/circuit';
import { HARD, createRaster, edt2, padShape, rectShape, stampBoardObstacles, stampShape } from './raster';
import type { Raster, Shape } from './raster';
import type { Board, DesignRules, Layer, PlacedPad, Rect, Track, Via, Zone } from './types';
import { netWidth } from './types';

export interface RouteInput {
  circuit: Circuit;
  board: Board;
  rules: DesignRules;
  pads: PlacedPad[];
  zones: Zone[];
  vias: Via[];
  keepouts: Rect[];
  layerKeepouts: Array<{ layer: Layer; rect: Rect }>;
  /** Nets routed first (rip-up & reroute priority). */
  priority?: string[];
  /**
   * Ground strategy: 'split' = stub vias for normal pads before signals and for fine-pitch pads after,
   * 'first' = all ground stubs before signals, 'last' = all ground after signals.
   */
  gndStrategy?: GndStrategy;
  /** Kept ground-pour masks from a previous pass: ground islands may terminate on them (plane repair). */
  gndPourTargets?: Record<Layer, Uint8Array>;
  /** Pre-routed tracks (fan-out). */
  preTracks?: Track[];
  /** Areas where no new via may be placed. */
  viaKeepouts?: Rect[];
  /** Fan-out nets in preferred routing order (row centre first). */
  fanoutOrder?: string[];
}

export type GndStrategy = 'split' | 'first' | 'last' | 'tree-first';
/** Pads narrower than this are treated as fine-pitch (their ground stub is routed after the signals). */
const FINE_PITCH_PAD = 0.4;

export interface RouteResult {
  tracks: Track[];
  vias: Via[];
  unrouted: Array<{ net: string; detail: string }>;
  neckdowns: Array<{ net: string; width: number }>;
  raster: Raster;
  netIds: Map<string, number>;
  log: string[];
  expanded: number;
}

interface Item {
  layers: Layer[];
  shape: Shape;
  island: number;
  isPad: boolean;
  padIndex?: number;
}

const LAYERS: Layer[] = ['F', 'B'];
/** Window margin around a net's bounding box [mm]. */
const WINDOW_MARGIN = 6;
const GND_WINDOW = 5;
/** Minimum drill-to-drill spacing [mm]. */
export const HOLE_TO_HOLE = 0.25;
/** Above this number of target items the A* heuristic is dropped (Dijkstra) to keep expansions cheap. */
const MAX_HEURISTIC_TARGETS = 16;

const itemBox = (s: Shape): [number, number, number, number] => {
  if (s.kind === 'circle') return [s.x - s.r, s.y - s.r, s.x + s.r, s.y + s.r];
  if (s.kind === 'seg') return [Math.min(s.x1, s.x2) - s.hw, Math.min(s.y1, s.y2) - s.hw, Math.max(s.x1, s.x2) + s.hw, Math.max(s.y1, s.y2) + s.hw];
  return [s.x, s.y, s.x + s.w, s.y + s.h];
};

/** Binary min-heap on (key, value). */
const createHeap = () => {
  let keys = new Float64Array(1024);
  let vals = new Int32Array(1024);
  let n = 0;
  const push = (k: number, v: number): void => {
    if (n === keys.length) {
      const nk = new Float64Array(n * 2); nk.set(keys); keys = nk;
      const nv = new Int32Array(n * 2); nv.set(vals); vals = nv;
    }
    let i = n++;
    keys[i] = k; vals[i] = v;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= keys[i]) break;
      const tk = keys[p]; keys[p] = keys[i]; keys[i] = tk;
      const tv = vals[p]; vals[p] = vals[i]; vals[i] = tv;
      i = p;
    }
  };
  const pop = (): number => {
    const top = vals[0];
    n--;
    if (n > 0) {
      keys[0] = keys[n]; vals[0] = vals[n];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < n && keys[l] < keys[m]) m = l;
        if (r < n && keys[r] < keys[m]) m = r;
        if (m === i) break;
        const tk = keys[m]; keys[m] = keys[i]; keys[i] = tk;
        const tv = vals[m]; vals[m] = vals[i]; vals[i] = tv;
        i = m;
      }
    }
    return top;
  };
  return { push, pop, size: () => n };
};

export const routeBoard = (inp: RouteInput): RouteResult => {
  const { board, rules, circuit } = inp;
  const r = createRaster(board, rules.grid);
  const g = r.g;
  const log: string[] = [];
  const tracks: Track[] = [];
  const vias: Via[] = [...inp.vias];
  const unrouted: RouteResult['unrouted'] = [];
  const neckdowns: RouteResult['neckdowns'] = [];
  let expandedTotal = 0;

  // ---------- net ids (NC pads get unique ids) ----------
  const netIds = new Map<string, number>();
  let nextId = 1;
  for (const n of circuit.nets) netIds.set(n.name, nextId++);
  const clsOf = new Map<string, NetClass>(circuit.nets.map((n) => [n.name, n.cls]));
  const padId = inp.pads.map((p) => (p.net ? netIds.get(p.net)! : p.npth ? 0 : nextId++));

  // ---------- obstacles ----------
  const holes = inp.pads.filter((p) => p.npth).map((p) => ({ x: p.x, y: p.y, r: (p.drill ?? p.w) / 2 }));
  stampBoardObstacles(r, board, rules.edgeClearance, holes, inp.keepouts);
  for (const k of inp.layerKeepouts) {
    const [i0, j0] = r.cellOf(k.rect.x, k.rect.y);
    const [i1, j1] = r.cellOf(k.rect.x + k.rect.w, k.rect.y + k.rect.h);
    for (let j = Math.max(0, j0); j <= Math.min(r.ny - 1, j1); j++)
      for (let i = Math.max(0, i0); i <= Math.min(r.nx - 1, i1); i++) r.keep[k.layer][r.idx(i, j)] = HARD;
  }

  // ---------- items per net ----------
  const items = new Map<string, Item[]>();
  const addItem = (net: string, it: Item): void => {
    if (!items.has(net)) items.set(net, []);
    items.get(net)!.push(it);
  };
  inp.pads.forEach((p, k) => {
    if (p.npth) return;
    const s = padShape(p);
    for (const L of p.layers) stampShape(r, L, s, padId[k], rules.clearance);
    if (p.net) addItem(p.net, { layers: p.layers, shape: s, island: -1, isPad: true, padIndex: k });
  });
  for (const z of inp.zones) {
    const id = netIds.get(z.net)!;
    for (const rc of z.rects) {
      stampShape(r, z.layer, rectShape(rc), id, rules.clearance);
      addItem(z.net, { layers: [z.layer], shape: rectShape(rc), island: -1, isPad: false });
    }
  }
  for (const t of inp.preTracks ?? []) {
    const id = netIds.get(t.net)!;
    const s: Shape = { kind: 'seg', x1: t.x1, y1: t.y1, x2: t.x2, y2: t.y2, hw: t.width / 2 };
    stampShape(r, t.layer, s, id, rules.clearance);
    addItem(t.net, { layers: [t.layer], shape: s, island: -1, isPad: false });
    tracks.push(t);
  }
  for (const v of inp.vias) {
    const id = netIds.get(v.net)!;
    const s: Shape = { kind: 'circle', x: v.x, y: v.y, r: v.d / 2 };
    for (const L of LAYERS) stampShape(r, L, s, id, rules.clearance);
    addItem(v.net, { layers: ['F', 'B'], shape: s, island: -1, isPad: false });
  }

  // ---------- island bookkeeping (union-find on items, touching same-layer items merge) ----------
  const initIslands = (list: Item[]): number[] => {
    const parent = list.map((_, i) => i);
    const find = (a: number): number => (parent[a] === a ? a : (parent[a] = find(parent[a])));
    for (let a = 0; a < list.length; a++)
      for (let b = a + 1; b < list.length; b++) {
        const A = list[a], B = list[b];
        if (!A.layers.some((L) => B.layers.includes(L))) continue;
        const [ax0, ay0, ax1, ay1] = itemBox(A.shape);
        const [bx0, by0, bx1, by1] = itemBox(B.shape);
        if (ax0 <= bx1 && bx0 <= ax1 && ay0 <= by1 && by0 <= ay1) parent[find(a)] = find(b);
      }
    return list.map((_, i) => find(i));
  };

  // ---------- routing of one connection set for a net ----------
  const routeNet = (net: string, gndStub: boolean, stubFilter?: (p: PlacedPad) => boolean): void => {
    const id = netIds.get(net)!;
    const list = items.get(net) ?? [];
    if (list.length === 0) return;
    const baseWidth = netWidth(rules, net, clsOf.get(net) ?? 'signal');
    const widths = [...new Set([baseWidth, Math.min(baseWidth, rules.trackWidth.power3v3), rules.trackWidth.signal])].filter((w) => w <= baseWidth);

    // window
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    for (const it of list) {
      const [a, b, c, d] = itemBox(it.shape);
      bx0 = Math.min(bx0, a); by0 = Math.min(by0, b); bx1 = Math.max(bx1, c); by1 = Math.max(by1, d);
    }
    const m = gndStub ? GND_WINDOW : WINDOW_MARGIN;
    const [wi0, wj0] = r.cellOf(Math.max(r.x0, bx0 - m), Math.max(r.y0, by0 - m));
    const [wi1, wj1] = r.cellOf(Math.min(-r.x0 - 1e-6, bx1 + m), Math.min(-r.y0 - 1e-6, by1 + m));
    const ww = wi1 - wi0 + 1, wh = wj1 - wj0 + 1;
    const NW = ww * wh;
    const gIdx = (li: number): number => (wj0 + Math.floor(li / ww)) * r.nx + wi0 + (li % ww);

    // distance to foreign keep-out per layer
    const dist2: Record<Layer, Float32Array> = { F: new Float32Array(0), B: new Float32Array(0) };
    for (const L of LAYERS) {
      const mask = new Uint8Array(NW);
      const keep = r.keep[L];
      for (let li = 0; li < NW; li++) {
        const k = keep[gIdx(li)];
        mask[li] = k !== 0 && k !== id ? 1 : 0;
      }
      dist2[L] = edt2(mask, ww, wh);
    }
    const viaR = rules.viaDiameter / 2 + 0.75 * g;
    const viaLim = (viaR / g) ** 2;
    const viaOk = new Uint8Array(NW);
    for (let li = 0; li < NW; li++) viaOk[li] = dist2.F[li] > viaLim && dist2.B[li] > viaLim ? 1 : 0;
    // drill-to-drill spacing against every existing hole (vias of any net, THT pads)
    const blockHoles = (): void => {
      const holesNow: Array<{ x: number; y: number; r: number }> = [
        ...vias.map((v) => ({ x: v.x, y: v.y, r: v.drill / 2 })),
        ...inp.pads.filter((p) => p.drill).map((p) => ({ x: p.x, y: p.y, r: (p.drill ?? 0) / 2 })),
      ];
      for (const h of holesNow) {
        const R = h.r + HOLE_TO_HOLE + rules.viaDrill / 2 + 0.5 * g;
        const [ci0, cj0] = r.cellOf(h.x - R, h.y - R);
        const [ci1, cj1] = r.cellOf(h.x + R, h.y + R);
        for (let j = Math.max(cj0, wj0); j <= Math.min(cj1, wj1); j++)
          for (let i = Math.max(ci0, wi0); i <= Math.min(ci1, wi1); i++) {
            const [x, y] = r.centerOf(i, j);
            if (Math.hypot(x - h.x, y - h.y) < R) viaOk[(j - wj0) * ww + (i - wi0)] = 0;
          }
      }
    };
    blockHoles();
    for (const k of inp.viaKeepouts ?? []) {
      const [ci0, cj0] = r.cellOf(k.x - viaR, k.y - viaR);
      const [ci1, cj1] = r.cellOf(k.x + k.w + viaR, k.y + k.h + viaR);
      for (let j = Math.max(cj0, wj0); j <= Math.min(cj1, wj1); j++)
        for (let i = Math.max(ci0, wi0); i <= Math.min(ci1, wi1); i++) viaOk[(j - wj0) * ww + (i - wi0)] = 0;
    }

    const islands = initIslands(list);
    list.forEach((it, i) => (it.island = islands[i]));

    const cellsOfItem = (it: Item, L: Layer, fn: (li: number) => void): void => {
      if (!it.layers.includes(L)) return;
      const [a, b, c, d] = itemBox(it.shape);
      const [i0, j0] = r.cellOf(a, b);
      const [i1, j1] = r.cellOf(c, d);
      for (let j = Math.max(j0, wj0); j <= Math.min(j1, wj1); j++)
        for (let i = Math.max(i0, wi0); i <= Math.min(i1, wi1); i++) {
          const [x, y] = r.centerOf(i, j);
          const s = it.shape;
          const inside = s.kind === 'circle' ? Math.hypot(x - s.x, y - s.y) <= s.r : s.kind === 'rect' ? x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h : false;
          if (inside) fn((j - wj0) * ww + (i - wi0));
        }
    };

    const connectOnce = (srcIsland: number, width: number, extra?: { masks: Record<Layer, Uint8Array>; island: number }): { hit: number; stub?: boolean } | null => {
      // 1.5 cells of margin: the any-angle string-pulled segments may deviate ~0.7 cell from checked centers
      const hw = width / 2 + 1.5 * g;
      const lim = (hw / g) ** 2;
      const free = (L: Layer, li: number): boolean => dist2[L][li] > lim;
      const target = new Int32Array(2 * NW).fill(-1);
      const gScore = new Float32Array(2 * NW).fill(Infinity);
      const parent = new Int32Array(2 * NW).fill(-1);
      const closed = new Uint8Array(2 * NW);
      const heap = createHeap();
      const tcenters: Array<[number, number]> = [];
      list.forEach((it) => {
        for (const [li0, L] of LAYERS.entries()) {
          if (it.island === srcIsland) {
            cellsOfItem(it, L, (li) => {
              if (!free(L, li)) return;
              const s = li0 * NW + li;
              if (gScore[s] > 0) { gScore[s] = 0; heap.push(0, s); }
            });
          } else {
            // ground stubs may also terminate on nearby ground copper of another island
            cellsOfItem(it, L, (li) => {
              if (free(L, li)) target[li0 * NW + li] = it.island;
            });
          }
        }
        if (it.island !== srcIsland && !gndStub) {
          const [a, b, c, d] = itemBox(it.shape);
          tcenters.push([((a + c) / 2 - r.x0) / g - 0.5 - wi0, ((b + d) / 2 - r.y0) / g - 0.5 - wj0]);
        }
      });
      if (extra) {
        for (const [li0, L] of LAYERS.entries()) {
          const mk = extra.masks[L];
          for (let li = 0; li < NW; li++) if (mk[gIdx(li)] && free(L, li) && target[li0 * NW + li] < 0) target[li0 * NW + li] = extra.island;
        }
      }
      if (heap.size() === 0) return null;
      const h = (li: number): number => {
        if (extra) return 0;
        if (gndStub || tcenters.length === 0 || tcenters.length > MAX_HEURISTIC_TARGETS) return 0;
        const i = li % ww, j = Math.floor(li / ww);
        let best = Infinity;
        for (const [tx, ty] of tcenters) {
          const dx = Math.abs(i - tx), dy = Math.abs(j - ty);
          best = Math.min(best, Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy));
        }
        return Math.max(0, best - 8);
      };
      // re-key the seeds with heuristic
      let goal = -1;
      let expanded = 0;
      const srcMask = new Uint8Array(NW);
      if (gndStub) list.forEach((it) => it.island === srcIsland && cellsOfItem(it, 'F', (li) => (srcMask[li] = 1)));
      while (heap.size() > 0) {
        const s = heap.pop();
        if (closed[s]) continue;
        closed[s] = 1;
        expanded++;
        const L: Layer = s >= NW ? 'B' : 'F';
        const li = s % NW;
        if (target[s] >= 0) { goal = s; break; }
        // stub goal: a via site outside the pad itself (avoid via-in-pad) on the top layer
        if (gndStub && L === 'F' && viaOk[li] && !srcMask[li]) { goal = s; break; }
        const i = li % ww, j = Math.floor(li / ww);
        const base = gScore[s];
        const pen = L === 'B' ? rules.bottomPenalty : 1;
        for (let dj = -1; dj <= 1; dj++)
          for (let di = -1; di <= 1; di++) {
            if (!di && !dj) continue;
            const ni = i + di, nj = j + dj;
            if (ni < 0 || nj < 0 || ni >= ww || nj >= wh) continue;
            const nli = nj * ww + ni;
            if (!free(L, nli)) continue;
            const ns = (L === 'B' ? NW : 0) + nli;
            if (closed[ns]) continue;
            const c = base + (di && dj ? Math.SQRT2 : 1) * pen;
            if (c < gScore[ns]) {
              gScore[ns] = c;
              parent[ns] = s;
              heap.push(c + h(nli), ns);
            }
          }
        if (!gndStub && viaOk[li]) {
          const os = (L === 'B' ? 0 : NW) + li;
          const c = base + rules.viaCost;
          if (!closed[os] && c < gScore[os]) {
            gScore[os] = c;
            parent[os] = s;
            heap.push(c + h(li), os);
          }
        }
        if (expanded > 4_000_000) break;
      }
      expandedTotal += expanded;
      if (goal < 0) return null;
      // ---------- backtrack ----------
      const path: number[] = [];
      for (let s = goal; s !== -1; s = parent[s]) path.push(s);
      path.reverse();
      const toXY = (li: number): [number, number] => r.centerOf(wi0 + (li % ww), wj0 + Math.floor(li / ww));
      const lineFree = (L: Layer, a: number, b: number): boolean => {
        let x0 = a % ww, y0 = Math.floor(a / ww);
        const x1 = b % ww, y1 = Math.floor(b / ww);
        const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
        const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
        let err = dx + dy;
        for (;;) {
          if (!free(L, y0 * ww + x0)) return false;
          if (x0 === x1 && y0 === y1) return true;
          const e2 = 2 * err;
          if (e2 >= dy) {
            // check the side cell too (thick Bresenham) so diagonal steps don't cut corners
            if (e2 <= dx && !free(L, y0 * ww + x0 + sx)) return false;
            err += dy; x0 += sx;
          }
          if (e2 <= dx) { err += dx; y0 += sy; }
        }
      };
      // split into layer runs
      const runs: Array<{ L: Layer; cells: number[] }> = [];
      for (const s of path) {
        const L: Layer = s >= NW ? 'B' : 'F';
        const li = s % NW;
        if (!runs.length || runs[runs.length - 1].L !== L) runs.push({ L, cells: [] });
        runs[runs.length - 1].cells.push(li);
      }
      for (let ri = 0; ri < runs.length; ri++) {
        const run = runs[ri];
        // string pulling
        const pts: number[] = [run.cells[0]];
        let a = 0;
        while (a < run.cells.length - 1) {
          let b = run.cells.length - 1;
          while (b > a + 1 && !lineFree(run.L, run.cells[a], run.cells[b])) b--;
          pts.push(run.cells[b]);
          a = b;
        }
        for (let k = 1; k < pts.length; k++) {
          const [x1, y1] = toXY(pts[k - 1]);
          const [x2, y2] = toXY(pts[k]);
          const t: Track = { net, layer: run.L, x1, y1, x2, y2, width };
          tracks.push(t);
          const sh: Shape = { kind: 'seg', x1, y1, x2, y2, hw: width / 2 };
          stampShape(r, run.L, sh, id, rules.clearance);
          list.push({ layers: [run.L], shape: sh, island: srcIsland, isPad: false });
        }
        if (ri < runs.length - 1) {
          const [vx, vy] = toXY(run.cells[run.cells.length - 1]);
          const v: Via = { net, x: vx, y: vy, d: rules.viaDiameter, drill: rules.viaDrill, kind: 'route' };
          vias.push(v);
          const sh: Shape = { kind: 'circle', x: vx, y: vy, r: v.d / 2 };
          for (const L2 of LAYERS) stampShape(r, L2, sh, id, rules.clearance);
          list.push({ layers: ['F', 'B'], shape: sh, island: srcIsland, isPad: false });
        }
      }
      if (gndStub && target[goal] < 0) {
        const [vx, vy] = toXY(goal % NW);
        const v: Via = { net, x: vx, y: vy, d: rules.viaDiameter, drill: rules.viaDrill, kind: 'gnd' };
        vias.push(v);
        const sh: Shape = { kind: 'circle', x: vx, y: vy, r: v.d / 2 };
        for (const L2 of LAYERS) stampShape(r, L2, sh, id, rules.clearance);
        list.push({ layers: ['F', 'B'], shape: sh, island: srcIsland, isPad: false });
        return { hit: srcIsland, stub: true };
      }
      return { hit: target[goal], stub: gndStub };
    };

    if (gndStub) {
      // every top-only GND pad gets its own stub + via unless it already touches a via / THT copper
      const padIslands = [...new Set(list.filter((it) => it.isPad && it.layers.length === 1 && (!stubFilter || stubFilter(inp.pads[it.padIndex!]))).map((it) => it.island))];
      for (const isl of padIslands) {
        const hasVia = list.some((it) => it.island === isl && it.layers.length === 2);
        if (hasVia) continue;
        let ok = false;
        blockHoles();
        for (const w of widths) {
          const res = connectOnce(isl, w);
          if (res) {
            if (res.hit !== isl) for (const it of list) if (it.island === res.hit) it.island = isl;
            ok = true;
            if (w !== baseWidth) neckdowns.push({ net, width: w });
            break;
          }
        }
        if (!ok) unrouted.push({ net, detail: `GND パッドからビアを置けない（島 ${isl}）` });
      }
      return;
    }

    // plane repair: islands already touching the kept pour of the previous pass count as connected
    const pourT = net === 'GND' ? inp.gndPourTargets : undefined;
    let mainIsland = -1;
    if (pourT) {
      const anchorItem = list.find((it) => it.isPad && it.layers.length === 2) ?? list.find((it) => it.isPad);
      mainIsland = anchorItem ? anchorItem.island : list[0].island;
      const touching = new Set<number>();
      for (const it of list)
        for (const L of it.layers)
          cellsOfItem(it, L, (li) => {
            if (pourT[L][gIdx(li)]) touching.add(it.island);
          });
      for (const it of list) if (touching.has(it.island)) it.island = mainIsland;
    }
    for (let guard = 0; guard < 200; guard++) {
      const isl = [...new Set(list.map((it) => it.island))];
      if (isl.length <= 1) break;
      const src = pourT ? isl.find((x) => x !== mainIsland) ?? isl[0] : list.find((it) => it.isPad)?.island ?? isl[0];
      let res: { hit: number } | null = null;
      for (const w of widths) {
        res = connectOnce(src, w, pourT ? { masks: pourT, island: mainIsland } : undefined);
        if (res) {
          if (w !== baseWidth) neckdowns.push({ net, width: w });
          break;
        }
      }
      if (!res) {
        const remaining = list.filter((it) => it.isPad && it.island !== src).map((it) => `${inp.pads[it.padIndex!].ref}.${inp.pads[it.padIndex!].num}`);
        unrouted.push({ net, detail: `未接続: ${[...new Set(remaining)].join(', ')}` });
        break;
      }
      const hit = res.hit;
      const into = pourT && hit === mainIsland ? mainIsland : src;
      const from = into === src ? hit : src;
      for (const it of list) if (it.island === from) it.island = into;
      blockHoles();
    }
  };

  // ---------- order ----------
  const nets = circuit.nets.map((n) => n.name);
  const span = (net: string): number => {
    const ps = inp.pads.filter((p) => p.net === net);
    const xs = ps.map((p) => p.x), ys = ps.map((p) => p.y);
    return Math.max(...xs) - Math.min(...xs) + Math.max(...ys) - Math.min(...ys);
  };
  const pri = new Set(inp.priority ?? []);
  // nets that leave fine-pitch fan-outs are routed before the wide power nets claim the space around them
  const fanoutNets = new Set((inp.preTracks ?? []).map((t) => t.net).filter((n) => clsOf.get(n) === 'signal'));
  const fanoutIdx = new Map((inp.fanoutOrder ?? []).map((n, i) => [n, i]));
  const order = nets
    .filter((n) => n !== 'GND')
    .sort((a, b) => {
      const pa = pri.has(a) ? 0 : 1, pb = pri.has(b) ? 0 : 1;
      if (pa !== pb) return pa - pb;
      const fa = fanoutNets.has(a) ? 0 : 1, fb = fanoutNets.has(b) ? 0 : 1;
      if (fa !== fb) return fa - fb;
      if (fa === 0) {
        const oa = fanoutIdx.get(a) ?? 99, ob = fanoutIdx.get(b) ?? 99;
        if (oa !== ob) return oa - ob;
      }
      const wa = netWidth(rules, a, clsOf.get(a) ?? 'signal'), wb = netWidth(rules, b, clsOf.get(b) ?? 'signal');
      if (wa !== wb) return wb - wa;
      return span(a) - span(b);
    });
  const strategy = inp.gndStrategy ?? 'split';
  const coarse = (p: PlacedPad): boolean => Math.min(p.w, p.h) >= FINE_PITCH_PAD;
  const hasGnd = netIds.has('GND');
  if (hasGnd && (strategy === 'first' || strategy === 'tree-first')) routeNet('GND', true);
  if (hasGnd && strategy === 'tree-first') routeNet('GND', false);
  if (hasGnd && strategy === 'split') routeNet('GND', true, coarse);
  for (const n of order) routeNet(n, false);
  if (hasGnd && strategy !== 'first' && strategy !== 'tree-first') routeNet('GND', true);
  // connect all ground islands with real copper so the plane may be fragmented by bottom-layer signals
  if (netIds.has('GND')) routeNet('GND', false);
  log.push(`配線: トラック ${tracks.length} 本、ビア ${vias.length} 個、未配線 ${unrouted.length}、A* 展開 ${expandedTotal} セル`);
  return { tracks, vias, unrouted, neckdowns, raster: r, netIds, log, expanded: expandedTotal };
};
