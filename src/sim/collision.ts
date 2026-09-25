import type { Vec3 } from '../core/math';
import { clamp } from '../core/math';
import type { Obstacle } from '../core/types';

/** Euclidean distance from point to obstacle surface (0 if inside). */
export const distanceToObstacle = (p: Vec3, o: Obstacle): number => {
  if (o.kind === 'box') {
    const hx = o.size.x / 2, hy = o.size.y / 2, hz = o.size.z / 2;
    const dx = Math.max(Math.abs(p.x - o.center.x) - hx, 0);
    const dy = Math.max(Math.abs(p.y - o.center.y) - hy, 0);
    const dz = Math.max(Math.abs(p.z - o.center.z) - hz, 0);
    return Math.hypot(dx, dy, dz);
  }
  const radial = Math.max(Math.hypot(p.x - o.base.x, p.y - o.base.y) - o.radius, 0);
  const zc = clamp(p.z, o.base.z, o.base.z + o.height);
  const dz = Math.abs(p.z - zc);
  return Math.hypot(radial, dz);
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

export const sphereHitsObstacle = (p: Vec3, r: number, o: Obstacle): boolean => distanceToObstacle(p, o) < r;
