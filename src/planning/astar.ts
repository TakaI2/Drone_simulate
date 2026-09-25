import type { Vec3 } from '../core/math';
import type { VoxelGrid } from './voxel';

/** Binary min-heap keyed by f-score. */
const createHeap = () => {
  const items: number[] = [];
  const keys: number[] = [];
  const push = (item: number, key: number): void => {
    items.push(item);
    keys.push(key);
    let i = items.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= keys[i]) break;
      [items[p], items[i]] = [items[i], items[p]];
      [keys[p], keys[i]] = [keys[i], keys[p]];
      i = p;
    }
  };
  const pop = (): number | undefined => {
    if (items.length === 0) return undefined;
    const top = items[0];
    const lastI = items.pop() as number;
    const lastK = keys.pop() as number;
    if (items.length > 0) {
      items[0] = lastI;
      keys[0] = lastK;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < items.length && keys[l] < keys[m]) m = l;
        if (r < items.length && keys[r] < keys[m]) m = r;
        if (m === i) break;
        [items[m], items[i]] = [items[i], items[m]];
        [keys[m], keys[i]] = [keys[i], keys[m]];
        i = m;
      }
    }
    return top;
  };
  return { push, pop, size: () => items.length };
};

const NEIGHBORS: Array<[number, number, number, number]> = [];
for (let dz = -1; dz <= 1; dz++)
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) if (dx || dy || dz) NEIGHBORS.push([dx, dy, dz, Math.hypot(dx, dy, dz)]);

export interface PlanResult {
  path: Vec3[];
  expanded: number;
}

/** 26-connected A* on the voxel grid. Start/goal are snapped to the nearest free cell. */
export const astar = (grid: VoxelGrid, start: Vec3, goal: Vec3): PlanResult | null => {
  const snap = (p: Vec3): [number, number, number] | null => {
    const [i0, j0, k0] = grid.toCell(p);
    for (let r = 0; r < 6; r++) {
      for (let dk = -r; dk <= r; dk++)
        for (let dj = -r; dj <= r; dj++)
          for (let di = -r; di <= r; di++) {
            const i = i0 + di, j = j0 + dj, k = k0 + dk;
            if (grid.inBounds(i, j, k) && grid.occ[grid.index(i, j, k)] === 0) return [i, j, k];
          }
    }
    return null;
  };
  const s = snap(start);
  const g = snap(goal);
  if (!s || !g) return null;
  const N = grid.nx * grid.ny * grid.nz;
  const gScore = new Float64Array(N).fill(Infinity);
  const came = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const si = grid.index(...s);
  const gi = grid.index(...g);
  const h = (i: number, j: number, k: number): number => Math.hypot(i - g[0], j - g[1], k - g[2]);
  const heap = createHeap();
  gScore[si] = 0;
  heap.push(si, h(...s));
  let expanded = 0;
  const nxy = grid.nx * grid.ny;
  while (heap.size() > 0) {
    const cur = heap.pop() as number;
    if (closed[cur]) continue;
    if (cur === gi) break;
    closed[cur] = 1;
    expanded++;
    const k = Math.floor(cur / nxy);
    const j = Math.floor((cur - k * nxy) / grid.nx);
    const i = cur - k * nxy - j * grid.nx;
    for (const [dx, dy, dz, c] of NEIGHBORS) {
      const ni = i + dx, nj = j + dy, nk = k + dz;
      if (!grid.inBounds(ni, nj, nk)) continue;
      const nidx = grid.index(ni, nj, nk);
      if (grid.occ[nidx] || closed[nidx]) continue;
      const tentative = gScore[cur] + c;
      if (tentative < gScore[nidx]) {
        gScore[nidx] = tentative;
        came[nidx] = cur;
        heap.push(nidx, tentative + h(ni, nj, nk));
      }
    }
  }
  if (!Number.isFinite(gScore[gi])) return null;
  const cells: number[] = [];
  for (let c = gi; c !== -1; c = came[c]) cells.push(c);
  cells.reverse();
  const path = cells.map((c) => {
    const k = Math.floor(c / nxy);
    const j = Math.floor((c - k * nxy) / grid.nx);
    const i = c - k * nxy - j * grid.nx;
    return grid.toWorld(i, j, k);
  });
  // replace snapped endpoints by the exact requested points when reachable in a straight line
  if (grid.lineFree(start, path[0])) path[0] = { ...start };
  if (grid.lineFree(path[path.length - 1], goal)) path[path.length - 1] = { ...goal };
  return { path, expanded };
};

/** Greedy string-pulling: keep the farthest visible vertex. */
export const shortcutPath = (grid: VoxelGrid, path: Vec3[]): Vec3[] => {
  if (path.length <= 2) return path;
  const out: Vec3[] = [path[0]];
  let i = 0;
  while (i < path.length - 1) {
    let j = path.length - 1;
    while (j > i + 1 && !grid.lineFree(path[i], path[j])) j--;
    out.push(path[j]);
    i = j;
  }
  return out;
};
