import type { Vec3 } from '../core/math';
import { v3, vDist, vLerp } from '../core/math';
import type { Obstacle } from '../core/types';
import { distanceToObstacle, distanceToPolygon2d, obstacleBounds } from '../sim/collision';

export interface VoxelGrid {
  min: Vec3;
  res: number;
  nx: number;
  ny: number;
  nz: number;
  occ: Uint8Array;
  index: (i: number, j: number, k: number) => number;
  inBounds: (i: number, j: number, k: number) => boolean;
  toCell: (p: Vec3) => [number, number, number];
  toWorld: (i: number, j: number, k: number) => Vec3;
  occupiedAt: (p: Vec3) => boolean;
  /** Segment clear of occupied cells (sampled at res/2). */
  lineFree: (a: Vec3, b: Vec3) => boolean;
}

export interface GridOptions {
  min: Vec3;
  max: Vec3;
  res: number;
  /** Obstacle inflation (vehicle radius + safety margin) [m]. */
  inflate: number;
  /** Minimum flight altitude (cells below are blocked) [m]. */
  floor: number;
  /** Ceiling clearance [m]. */
  ceilingMargin: number;
}

export const buildVoxelGrid = (obstacles: Obstacle[], o: GridOptions): VoxelGrid => {
  const nx = Math.ceil((o.max.x - o.min.x) / o.res);
  const ny = Math.ceil((o.max.y - o.min.y) / o.res);
  const nz = Math.ceil((o.max.z - o.min.z) / o.res);
  const occ = new Uint8Array(nx * ny * nz);
  const index = (i: number, j: number, k: number): number => (k * ny + j) * nx + i;
  const inBounds = (i: number, j: number, k: number): boolean => i >= 0 && j >= 0 && k >= 0 && i < nx && j < ny && k < nz;
  const toWorld = (i: number, j: number, k: number): Vec3 =>
    v3(o.min.x + (i + 0.5) * o.res, o.min.y + (j + 0.5) * o.res, o.min.z + (k + 0.5) * o.res);
  const toCell = (p: Vec3): [number, number, number] => [
    Math.floor((p.x - o.min.x) / o.res),
    Math.floor((p.y - o.min.y) / o.res),
    Math.floor((p.z - o.min.z) / o.res),
  ];
  // prisms (buildings) are filled column by column; other shapes are tested per cell
  const others = obstacles.filter((ob) => ob.kind !== 'prism');
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const c = toWorld(i, j, k);
        let blocked = c.z < o.floor || c.z > o.max.z - o.ceilingMargin;
        blocked ||= c.x < o.min.x + o.inflate || c.x > o.max.x - o.inflate || c.y < o.min.y + o.inflate || c.y > o.max.y - o.inflate;
        if (!blocked) {
          for (const ob of others) {
            if (distanceToObstacle(c, ob) < o.inflate) {
              blocked = true;
              break;
            }
          }
        }
        occ[index(i, j, k)] = blocked ? 1 : 0;
      }
    }
  }
  const r = o.inflate;
  for (const ob of obstacles) {
    if (ob.kind !== 'prism') continue;
    const b = obstacleBounds(ob);
    const i0 = Math.max(0, Math.floor((b.x0 - r - o.min.x) / o.res)), i1 = Math.min(nx - 1, Math.floor((b.x1 + r - o.min.x) / o.res));
    const j0 = Math.max(0, Math.floor((b.y0 - r - o.min.y) / o.res)), j1 = Math.min(ny - 1, Math.floor((b.y1 + r - o.min.y) / o.res));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const c = toWorld(i, j, 0);
        const d = distanceToPolygon2d(c.x, c.y, ob.footprint);
        if (d >= r) continue;
        const ext = Math.sqrt(r * r - d * d);
        const k0 = Math.max(0, Math.floor((ob.zMin - ext - o.min.z) / o.res)), k1 = Math.min(nz - 1, Math.floor((ob.zMax + ext - o.min.z) / o.res));
        for (let k = k0; k <= k1; k++) occ[index(i, j, k)] = 1;
      }
    }
  }
  const occupiedAt = (p: Vec3): boolean => {
    const [i, j, k] = toCell(p);
    return !inBounds(i, j, k) || occ[index(i, j, k)] === 1;
  };
  const lineFree = (a: Vec3, b: Vec3): boolean => {
    const steps = Math.max(1, Math.ceil(vDist(a, b) / (o.res / 2)));
    for (let s = 0; s <= steps; s++) if (occupiedAt(vLerp(a, b, s / steps))) return false;
    return true;
  };
  return { min: o.min, res: o.res, nx, ny, nz, occ, index, inBounds, toCell, toWorld, occupiedAt, lineFree };
};
