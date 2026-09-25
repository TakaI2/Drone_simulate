import type { Vec3 } from '../core/math';
import { vAdd, vDist, vDot, vNorm, vScale, vSub, v3 } from '../core/math';

export interface FollowerOptions {
  cruiseSpeed: number;
  accel: number;
  /** Speed factor at a 90-degree corner (0..1). */
  cornerSpeedFactor: number;
  /** Tracking error at which the carrot stops advancing [m]. */
  maxTrackingError: number;
}

export interface PathFollower {
  /** Advance the carrot and return position/velocity feed-forward setpoints. */
  step: (actual: Vec3, dt: number) => { pos: Vec3; vel: Vec3; done: boolean };
  totalLength: number;
}

/** Carrot-on-polyline follower with trapezoidal speed and corner slow-down. */
export const createPathFollower = (path: Vec3[], o: FollowerOptions): PathFollower => {
  const segLen = path.slice(1).map((p, i) => vDist(path[i], p));
  const cum = [0];
  for (const l of segLen) cum.push(cum[cum.length - 1] + l);
  const total = cum[cum.length - 1];
  // corner speed limit at each interior vertex
  const cornerV = path.map((_, i) => {
    if (i === 0 || i === path.length - 1) return 0;
    const a = vNorm(vSub(path[i], path[i - 1]));
    const b = vNorm(vSub(path[i + 1], path[i]));
    const cosT = Math.max(-1, Math.min(1, vDot(a, b)));
    // linear blend: straight -> cruise, 90deg -> cornerFactor, reversal -> ~0
    const f = cosT >= 0 ? o.cornerSpeedFactor + (1 - o.cornerSpeedFactor) * cosT : o.cornerSpeedFactor * (1 + cosT);
    return o.cruiseSpeed * Math.max(0.05, f);
  });
  let s = 0;
  let v = 0;

  const pointAt = (sq: number): { p: Vec3; dir: Vec3; seg: number } => {
    if (total <= 1e-9) return { p: path[path.length - 1], dir: v3(), seg: 0 };
    let i = 0;
    while (i < segLen.length - 1 && cum[i + 1] < sq) i++;
    const t = segLen[i] > 0 ? (sq - cum[i]) / segLen[i] : 0;
    const dir = vNorm(vSub(path[i + 1], path[i]));
    return { p: vAdd(path[i], vScale(vSub(path[i + 1], path[i]), Math.min(1, Math.max(0, t)))), dir, seg: i };
  };

  const step = (actual: Vec3, dt: number) => {
    const cur = pointAt(s);
    // braking constraint to the next vertex speed limit
    let vLimit = o.cruiseSpeed;
    for (let k = cur.seg + 1; k < path.length; k++) {
      const dist = cum[k] - s;
      vLimit = Math.min(vLimit, Math.sqrt(cornerV[k] ** 2 + 2 * o.accel * Math.max(0, dist)));
      if (dist > (o.cruiseSpeed ** 2) / o.accel) break;
    }
    const err = vDist(actual, cur.p);
    vLimit *= Math.max(0, 1 - err / o.maxTrackingError);
    v = v < vLimit ? Math.min(vLimit, v + o.accel * dt) : vLimit;
    s = Math.min(total, s + v * dt);
    const next = pointAt(s);
    const done = s >= total - 1e-6;
    return { pos: next.p, vel: done ? v3() : vScale(next.dir, v), done };
  };
  return { step, totalLength: total };
};
