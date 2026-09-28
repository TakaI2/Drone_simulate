import type { SkyMap } from '../core/types';
import { pointInPolygon } from '../sim/collision';
import type { CityBuilding } from './city';

export interface SkyViewOptions {
  /** Half extent of the square area [m]. */
  halfSize: number;
  gridSpacing: number;
  heights: readonly number[];
  /** Height raster / ray step [m]. */
  rayStep: number;
  rayRange: number;
  azimuths: number;
  /** Elevation mask [deg]: sky below it is not counted (receivers ignore low satellites). */
  elevationMask: number;
}

export interface HeightRaster {
  x0: number;
  y0: number;
  res: number;
  n: number;
  h: Float32Array;
  at: (x: number, y: number) => number;
}

/** Max building top per cell (cell centre inside a footprint). */
export const rasterizeHeights = (bs: CityBuilding[], halfSize: number, res: number): HeightRaster => {
  const n = Math.ceil((2 * halfSize) / res);
  const x0 = -halfSize, y0 = -halfSize;
  const h = new Float32Array(n * n);
  for (const b of bs) {
    const xs = b.footprint.map((p) => p.x), ys = b.footprint.map((p) => p.y);
    const i0 = Math.max(0, Math.floor((Math.min(...xs) - x0) / res)), i1 = Math.min(n - 1, Math.floor((Math.max(...xs) - x0) / res));
    const j0 = Math.max(0, Math.floor((Math.min(...ys) - y0) / res)), j1 = Math.min(n - 1, Math.floor((Math.max(...ys) - y0) / res));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        if (h[j * n + i] >= b.zMax) continue;
        if (pointInPolygon(x0 + (i + 0.5) * res, y0 + (j + 0.5) * res, b.footprint)) h[j * n + i] = b.zMax;
      }
  }
  const at = (x: number, y: number): number => {
    const i = Math.floor((x - x0) / res), j = Math.floor((y - y0) / res);
    return i < 0 || j < 0 || i >= n || j >= n ? 0 : h[j * n + i];
  };
  return { x0, y0, res, n, h, at };
};

/**
 * Open-sky fraction on a grid: for each point and azimuth, march outward over the height raster to find the
 * highest obstruction elevation; the visible part of the sky above the mask is averaged over azimuths.
 */
export const computeSkyMap = (bs: CityBuilding[], o: SkyViewOptions): { map: SkyMap; raster: HeightRaster } => {
  const raster = rasterizeHeights(bs, o.halfSize, o.rayStep);
  const nx = Math.floor((2 * o.halfSize) / o.gridSpacing) + 1;
  const ny = nx;
  const x0 = -o.halfSize, y0 = -o.halfSize;
  const mask = (o.elevationMask * Math.PI) / 180;
  const span = Math.PI / 2 - mask;
  const dirs = Array.from({ length: o.azimuths }, (_, a) => [Math.cos((2 * Math.PI * a) / o.azimuths), Math.sin((2 * Math.PI * a) / o.azimuths)]);
  const data = new Array<number>(nx * ny * o.heights.length).fill(1);
  o.heights.forEach((z, k) => {
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const x = x0 + i * o.gridSpacing, y = y0 + j * o.gridSpacing;
        if (raster.at(x, y) > z) {
          data[(k * ny + j) * nx + i] = 0;
          continue;
        }
        let vis = 0;
        for (const [dx, dy] of dirs) {
          let maxEl = 0;
          for (let r = o.rayStep; r <= o.rayRange; r += o.rayStep) {
            const hz = raster.at(x + dx * r, y + dy * r) - z;
            if (hz > 0) maxEl = Math.max(maxEl, Math.atan2(hz, r));
          }
          vis += (Math.PI / 2 - Math.max(mask, maxEl)) / span;
        }
        data[(k * ny + j) * nx + i] = vis / dirs.length;
      }
  });
  return { map: { x0, y0, spacing: o.gridSpacing, nx, ny, heights: [...o.heights], data }, raster };
};
