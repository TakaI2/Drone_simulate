import type { Pad } from '../parts3d/packages';
import type { Layer, PlacedPad, Placement, Rect } from './types';

/** Rotate a point (package coords) by rot degrees CCW then translate. */
export const transformPoint = (pl: Placement, x: number, y: number): { x: number; y: number } => {
  const r = ((pl.rot % 360) + 360) % 360;
  let rx = x, ry = y;
  if (r === 90) { rx = -y; ry = x; }
  else if (r === 180) { rx = -x; ry = -y; }
  else if (r === 270) { rx = y; ry = -x; }
  return { x: pl.x + rx, y: pl.y + ry };
};

export const rotSize = (rot: number, w: number, h: number): { w: number; h: number } =>
  ((rot % 180) + 180) % 180 === 90 ? { w: h, h: w } : { w, h };

export const placePad = (pl: Placement, p: Pad, net: string | null): PlacedPad => {
  const c = transformPoint(pl, p.x, p.y);
  const s = rotSize(pl.rot, p.w, p.h);
  const layers: Layer[] = p.drill ? ['F', 'B'] : ['F'];
  return { ref: pl.ref, num: p.num, net, x: c.x, y: c.y, w: s.w, h: s.h, shape: p.shape, drill: p.drill, npth: p.npth, layers };
};

/** Courtyard rectangle (board coords). */
export const courtyardRect = (pl: Placement, extra = 0): Rect => {
  const s = rotSize(pl.rot, pl.pkg.courtyard.w * 2 + extra * 2, pl.pkg.courtyard.h * 2 + extra * 2);
  return { x: pl.x - s.w / 2, y: pl.y - s.h / 2, w: s.w, h: s.h };
};

export const rectsOverlap = (a: Rect, b: Rect, gap = 0): boolean =>
  a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

export const rectInside = (a: Rect, outer: Rect): boolean =>
  a.x >= outer.x && a.y >= outer.y && a.x + a.w <= outer.x + outer.w && a.y + a.h <= outer.y + outer.h;

/** Distance from point to segment. */
export const pointSegDist = (px: number, py: number, x1: number, y1: number, x2: number, y2: number): number => {
  const dx = x2 - x1, dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
};

/** Minimum distance between two segments. */
export const segSegDist = (a1x: number, a1y: number, a2x: number, a2y: number, b1x: number, b1y: number, b2x: number, b2y: number): number => {
  const cross = (ox: number, oy: number, ax: number, ay: number, bx: number, by: number): number => (ax - ox) * (by - oy) - (ay - oy) * (bx - ox);
  const d1 = cross(b1x, b1y, b2x, b2y, a1x, a1y);
  const d2 = cross(b1x, b1y, b2x, b2y, a2x, a2y);
  const d3 = cross(a1x, a1y, a2x, a2y, b1x, b1y);
  const d4 = cross(a1x, a1y, a2x, a2y, b2x, b2y);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  return Math.min(
    pointSegDist(a1x, a1y, b1x, b1y, b2x, b2y),
    pointSegDist(a2x, a2y, b1x, b1y, b2x, b2y),
    pointSegDist(b1x, b1y, a1x, a1y, a2x, a2y),
    pointSegDist(b2x, b2y, a1x, a1y, a2x, a2y),
  );
};

/** Distance from segment to axis-aligned rectangle (0 if intersecting). */
export const segRectDist = (x1: number, y1: number, x2: number, y2: number, r: Rect): number => {
  const inside = (x: number, y: number): boolean => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  if (inside(x1, y1) || inside(x2, y2)) return 0;
  const X0 = r.x, Y0 = r.y, X1 = r.x + r.w, Y1 = r.y + r.h;
  return Math.min(
    segSegDist(x1, y1, x2, y2, X0, Y0, X1, Y0),
    segSegDist(x1, y1, x2, y2, X1, Y0, X1, Y1),
    segSegDist(x1, y1, x2, y2, X1, Y1, X0, Y1),
    segSegDist(x1, y1, x2, y2, X0, Y1, X0, Y0),
  );
};

export const rectRectDist = (a: Rect, b: Rect): number => {
  const dx = Math.max(0, Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w)));
  const dy = Math.max(0, Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h)));
  return Math.hypot(dx, dy);
};

export const padRect = (p: PlacedPad): Rect => ({ x: p.x - p.w / 2, y: p.y - p.h / 2, w: p.w, h: p.h });
