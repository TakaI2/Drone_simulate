import type { Obstacle } from '../core/types';
import type { EnuFrame } from './enu';

export interface XY {
  x: number;
  y: number;
}

export type HeightSource = 'plateau' | 'tag' | 'levels' | 'default';

/** Building as an extruded footprint in local ENU [m]. */
export interface CityBuilding {
  id: string;
  name?: string;
  footprint: XY[];
  zMin: number;
  zMax: number;
  heightSource: HeightSource;
}

export interface CityArea {
  name: string;
  /** Local origin (lat/lon) and the half extents of the square area [m]. */
  origin: { lat: number; lon: number };
  halfSize: number;
}

/** Height assumptions for OSM buildings without a height tag. */
export const OSM_HEIGHT_RULES = { storeyHeight: 3.2, defaultHeight: 10 } as const;

// ------------------------------------------------------------------ OSM (Overpass JSON with `out geom`)

interface OverpassNode {
  lat: number;
  lon: number;
}
interface OverpassMember {
  type: string;
  role: string;
  geometry?: OverpassNode[];
}
export interface OverpassElement {
  type: string;
  id: number;
  tags?: Record<string, string>;
  geometry?: OverpassNode[];
  members?: OverpassMember[];
}

const parseMeters = (s: string | undefined): number | null => {
  if (!s) return null;
  const v = parseFloat(s.replace(',', '.'));
  return Number.isFinite(v) && v > 0 ? v : null;
};

/** OSM buildings: height from `height`, else `building:levels` × storey height, else a default. */
export const buildingsFromOverpass = (elements: OverpassElement[], frame: EnuFrame): CityBuilding[] => {
  const out: CityBuilding[] = [];
  for (const e of elements) {
    const tags = e.tags ?? {};
    if (!tags.building && !tags['building:part']) continue;
    const rings: OverpassNode[][] = e.type === 'way' && e.geometry ? [e.geometry] : (e.members ?? []).filter((m) => m.role === 'outer' && m.geometry).map((m) => m.geometry as OverpassNode[]);
    const h = parseMeters(tags.height);
    const lv = parseMeters(tags['building:levels']);
    const minH = parseMeters(tags.min_height) ?? 0;
    const height = h ?? (lv !== null ? lv * OSM_HEIGHT_RULES.storeyHeight : OSM_HEIGHT_RULES.defaultHeight);
    const src: HeightSource = h !== null ? 'tag' : lv !== null ? 'levels' : 'default';
    rings.forEach((ring, i) => {
      const fp = ring.map((n) => frame.toEnu({ lat: n.lat, lon: n.lon, h: 0 })).map((p) => ({ x: p.x, y: p.y }));
      if (fp.length < 3) return;
      out.push({ id: `osm-${e.type}-${e.id}${rings.length > 1 ? `-${i}` : ''}`, name: tags.name, footprint: dropClosing(fp), zMin: minH, zMax: height, heightSource: src });
    });
  }
  return out;
};

// ------------------------------------------------------------------ PLATEAU CityGML (bldg, LOD1)

/**
 * Parse PLATEAU building GML by string scanning (files are tens of MB; a DOM is unnecessary).
 * Coordinates are "lat lon height" (EPSG:6697). The lowest face becomes the footprint, the highest vertex the top.
 */
export const buildingsFromCityGml = (gml: string, frame: EnuFrame, idPrefix = 'plateau'): CityBuilding[] => {
  const out: CityBuilding[] = [];
  const startTag = '<bldg:Building ';
  let pos = gml.indexOf(startTag);
  while (pos >= 0) {
    const end = gml.indexOf('</bldg:Building>', pos);
    if (end < 0) break;
    const block = gml.slice(pos, end);
    pos = gml.indexOf(startTag, end);
    const idm = /gml:id="([^"]+)"/.exec(block);
    const name = /<gml:name>([^<]+)<\/gml:name>/.exec(block)?.[1];
    // one solid per building, or one per BuildingPart
    let partNo = 0;
    for (let lod1 = block.indexOf('<bldg:lod1Solid>'); lod1 >= 0; lod1 = block.indexOf('<bldg:lod1Solid>', lod1 + 1)) {
      const solid = block.slice(lod1, block.indexOf('</bldg:lod1Solid>', lod1));
      const b = solidToBuilding(solid, frame);
      if (!b) continue;
      out.push({ ...b, id: `${idPrefix}-${idm?.[1] ?? out.length}${partNo ? `-p${partNo}` : ''}`, name });
      partNo++;
    }
  }
  return out;
};

const solidToBuilding = (solid: string, frame: EnuFrame): Omit<CityBuilding, 'id'> | null => {
  const polys: Array<Array<{ x: number; y: number; z: number }>> = [];
  const re = /<gml:posList[^>]*>([^<]+)<\/gml:posList>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(solid))) {
    const v = m[1].trim().split(/\s+/).map(Number);
    const pts: Array<{ x: number; y: number; z: number }> = [];
    for (let i = 0; i + 2 < v.length; i += 3) pts.push(frame.toEnu({ lat: v[i], lon: v[i + 1], h: v[i + 2] }));
    if (pts.length >= 3) polys.push(pts);
  }
  if (!polys.length) return null;
  let zMin = Infinity, zMax = -Infinity;
  for (const p of polys) for (const q of p) {
    zMin = Math.min(zMin, q.z);
    zMax = Math.max(zMax, q.z);
  }
  // footprint: the face whose vertices all lie at the bottom
  const bottom = polys.find((p) => p.every((q) => Math.abs(q.z - zMin) < 0.05)) ?? polys[0];
  const fp = dropClosing(bottom.map((q) => ({ x: q.x, y: q.y })));
  if (fp.length < 3 || zMax - zMin < 0.5) return null;
  return { footprint: fp, zMin, zMax, heightSource: 'plateau' };
};

const dropClosing = (fp: XY[]): XY[] => {
  const a = fp[0], b = fp[fp.length - 1];
  return fp.length > 1 && Math.hypot(a.x - b.x, a.y - b.y) < 1e-6 ? fp.slice(0, -1) : fp;
};

// ------------------------------------------------------------------ area / conversion

export const polygonArea = (fp: XY[]): number => {
  let s = 0;
  for (let i = 0; i < fp.length; i++) {
    const a = fp[i], b = fp[(i + 1) % fp.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
};

export const centroidOf = (fp: XY[]): XY => ({ x: fp.reduce((s, p) => s + p.x, 0) / fp.length, y: fp.reduce((s, p) => s + p.y, 0) / fp.length });

/** Keep buildings whose centroid lies in the square area; shift heights so the ground reference is z = 0. */
export const clipBuildings = (bs: CityBuilding[], halfSize: number, groundZ: number): CityBuilding[] =>
  bs
    .filter((b) => {
      const c = centroidOf(b.footprint);
      return Math.abs(c.x) <= halfSize && Math.abs(c.y) <= halfSize;
    })
    .map((b) => ({ ...b, zMin: Math.max(0, b.zMin - groundZ), zMax: b.zMax - groundZ }))
    .filter((b) => b.zMax > 0.5);

export const median = (v: number[]): number => {
  const s = [...v].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

export const toObstacles = (bs: CityBuilding[]): Obstacle[] =>
  bs.map((b) => ({ kind: 'prism', id: b.id, footprint: b.footprint, zMin: b.zMin, zMax: b.zMax }));
