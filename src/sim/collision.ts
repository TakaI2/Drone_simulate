import type { Vec3 } from '../core/math';
import { clamp } from '../core/math';
import type { Obstacle } from '../core/types';

type XY = { x: number; y: number };

/** Point in polygon (even-odd rule). */
export const pointInPolygon = (x: number, y: number, poly: XY[]): boolean => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
};

/** Horizontal distance from a point to a polygon (0 inside). */
export const distanceToPolygon2d = (x: number, y: number, poly: XY[]): number => {
  if (pointInPolygon(x, y, poly)) return 0;
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j], b = poly[i];
    const dx = b.x - a.x, dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? clamp(((x - a.x) * dx + (y - a.y) * dy) / l2, 0, 1) : 0;
    best = Math.min(best, Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy)));
  }
  return best;
};

/** Euclidean distance from point to obstacle surface (0 if inside). */
export const distanceToObstacle = (p: Vec3, o: Obstacle): number => {
  if (o.kind === 'box') {
    const hx = o.size.x / 2, hy = o.size.y / 2, hz = o.size.z / 2;
    const dx = Math.max(Math.abs(p.x - o.center.x) - hx, 0);
    const dy = Math.max(Math.abs(p.y - o.center.y) - hy, 0);
    const dz = Math.max(Math.abs(p.z - o.center.z) - hz, 0);
    return Math.hypot(dx, dy, dz);
  }
  if (o.kind === 'prism') {
    const dh = distanceToPolygon2d(p.x, p.y, o.footprint);
    const dz = p.z > o.zMax ? p.z - o.zMax : p.z < o.zMin ? o.zMin - p.z : 0;
    return Math.hypot(dh, dz);
  }
  const radial = Math.max(Math.hypot(p.x - o.base.x, p.y - o.base.y) - o.radius, 0);
  const zc = clamp(p.z, o.base.z, o.base.z + o.height);
  const dz = Math.abs(p.z - zc);
  return Math.hypot(radial, dz);
};

/** Horizontal bounding box of an obstacle. */
export const obstacleBounds = (o: Obstacle): { x0: number; y0: number; x1: number; y1: number } => {
  if (o.kind === 'box') return { x0: o.center.x - o.size.x / 2, y0: o.center.y - o.size.y / 2, x1: o.center.x + o.size.x / 2, y1: o.center.y + o.size.y / 2 };
  if (o.kind === 'cylinder') return { x0: o.base.x - o.radius, y0: o.base.y - o.radius, x1: o.base.x + o.radius, y1: o.base.y + o.radius };
  const xs = o.footprint.map((q) => q.x), ys = o.footprint.map((q) => q.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
};

export const minObstacleDistance = (p: Vec3, obstacles: Obstacle[]): { distance: number; id: string | null } => {
  let best = Infinity;
  let id: string | null = null;
  for (const o of obstacles) {
    const d = distanceToObstacle(p, o);
    if (d < best) {
      best = d;
      id = o.id;
    }
  }
  return { distance: best, id };
};

export interface ObstacleIndex {
  /** Nearest obstacle within `range` of p (distance Infinity if none). */
  nearest: (p: Vec3) => { distance: number; id: string | null };
}

/**
 * 2D uniform-grid index for many obstacles (city blocks). Each cell lists the obstacles whose bounds,
 * grown by `range`, overlap the cell, so a query only examines nearby obstacles.
 */
export const createObstacleIndex = (obstacles: Obstacle[], cell: number, range: number): ObstacleIndex => {
  if (obstacles.length === 0) return { nearest: () => ({ distance: Infinity, id: null }) };
  const bounds = obstacles.map(obstacleBounds);
  const x0 = Math.min(...bounds.map((b) => b.x0)) - range, y0 = Math.min(...bounds.map((b) => b.y0)) - range;
  const x1 = Math.max(...bounds.map((b) => b.x1)) + range, y1 = Math.max(...bounds.map((b) => b.y1)) + range;
  const nx = Math.max(1, Math.ceil((x1 - x0) / cell)), ny = Math.max(1, Math.ceil((y1 - y0) / cell));
  const cells: number[][] = Array.from({ length: nx * ny }, () => []);
  bounds.forEach((b, k) => {
    const i0 = Math.floor((b.x0 - range - x0) / cell), i1 = Math.floor((b.x1 + range - x0) / cell);
    const j0 = Math.floor((b.y0 - range - y0) / cell), j1 = Math.floor((b.y1 + range - y0) / cell);
    for (let j = Math.max(0, j0); j <= Math.min(ny - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(nx - 1, i1); i++) cells[j * nx + i].push(k);
  });
  const nearest = (p: Vec3): { distance: number; id: string | null } => {
    const i = Math.floor((p.x - x0) / cell), j = Math.floor((p.y - y0) / cell);
    if (i < 0 || j < 0 || i >= nx || j >= ny) return { distance: Infinity, id: null };
    let best = Infinity;
    let id: string | null = null;
    for (const k of cells[j * nx + i]) {
      const d = distanceToObstacle(p, obstacles[k]);
      if (d < best) {
        best = d;
        id = obstacles[k].id;
      }
    }
    return { distance: best, id };
  };
  return { nearest };
};

export const sphereHitsObstacle = (p: Vec3, r: number, o: Obstacle): boolean => distanceToObstacle(p, o) < r;
