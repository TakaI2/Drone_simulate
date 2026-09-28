/** Geodetic (lat/lon/height) to local ENU [m] around an origin, via ECEF (WGS84; JGD2011 differs by cm). */

const A = 6378137.0;
const F = 1 / 298.257223563;
const E2 = F * (2 - F);

export interface GeoPoint {
  lat: number;
  lon: number;
  /** Height [m] (ellipsoidal or orthometric; only differences matter locally). */
  h: number;
}

const rad = (d: number): number => (d * Math.PI) / 180;

const toEcef = (p: GeoPoint): [number, number, number] => {
  const la = rad(p.lat), lo = rad(p.lon);
  const n = A / Math.sqrt(1 - E2 * Math.sin(la) ** 2);
  return [(n + p.h) * Math.cos(la) * Math.cos(lo), (n + p.h) * Math.cos(la) * Math.sin(lo), (n * (1 - E2) + p.h) * Math.sin(la)];
};

export interface EnuFrame {
  origin: GeoPoint;
  toEnu: (p: GeoPoint) => { x: number; y: number; z: number };
}

export const createEnuFrame = (origin: GeoPoint): EnuFrame => {
  const [x0, y0, z0] = toEcef(origin);
  const la = rad(origin.lat), lo = rad(origin.lon);
  const sla = Math.sin(la), cla = Math.cos(la), slo = Math.sin(lo), clo = Math.cos(lo);
  const toEnu = (p: GeoPoint): { x: number; y: number; z: number } => {
    const [x, y, z] = toEcef(p);
    const dx = x - x0, dy = y - y0, dz = z - z0;
    return {
      x: -slo * dx + clo * dy,
      y: -sla * clo * dx - sla * slo * dy + cla * dz,
      z: cla * clo * dx + cla * slo * dy + sla * dz,
    };
  };
  return { origin, toEnu };
};
