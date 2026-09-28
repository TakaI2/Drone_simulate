import { describe, expect, it } from 'vitest';
import { v3 } from '../src/core/math';
import { createRng } from '../src/core/rng';
import { buildingsFromCityGml } from '../src/geo/city';
import type { CityBuilding } from '../src/geo/city';
import { createEnuFrame } from '../src/geo/enu';
import { computeSkyMap } from '../src/geo/skyview';
import { createObstacleIndex, distanceToObstacle } from '../src/sim/collision';
import { skyFractionAt } from '../src/sim/urban';
import { createWind } from '../src/sim/wind';

describe('T-Y city simulation', () => {
  it('T-Y1 ENU conversion around Minatomirai', () => {
    const f = createEnuFrame({ lat: 35.4575, lon: 139.632, h: 0 });
    const o = f.toEnu({ lat: 35.4575, lon: 139.632, h: 0 });
    expect(Math.hypot(o.x, o.y, o.z)).toBeLessThan(1e-6);
    const n = f.toEnu({ lat: 35.4585, lon: 139.632, h: 0 });
    expect(n.y).toBeCloseTo(110.9, 0);
    expect(Math.abs(n.x)).toBeLessThan(0.01);
    const e = f.toEnu({ lat: 35.4575, lon: 139.633, h: 0 });
    expect(e.x).toBeCloseTo(90.8, 0);
  });

  it('T-Y2 prism distance and grid index', () => {
    const sq = { kind: 'prism' as const, id: 'b', footprint: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], zMin: 0, zMax: 20 };
    expect(distanceToObstacle(v3(5, 5, 5), sq)).toBe(0);
    expect(distanceToObstacle(v3(13, 5, 5), sq)).toBeCloseTo(3, 9);
    expect(distanceToObstacle(v3(13, 14, 5), sq)).toBeCloseTo(5, 9);
    expect(distanceToObstacle(v3(5, 5, 26), sq)).toBeCloseTo(6, 9);
    const idx = createObstacleIndex([sq], 5, 20);
    expect(idx.nearest(v3(13, 5, 5)).distance).toBeCloseTo(3, 9);
    expect(idx.nearest(v3(200, 200, 5)).distance).toBe(Infinity);
  });

  it('T-Y3 CityGML LOD1 parsing (footprint, bottom, top)', () => {
    const f = createEnuFrame({ lat: 35.0, lon: 139.0, h: 0 });
    const ring = (h: number) => `35.0 139.0 ${h} 35.0001 139.0 ${h} 35.0001 139.0001 ${h} 35.0 139.0001 ${h} 35.0 139.0 ${h}`;
    const gml = `<core:cityObjectMember><bldg:Building gml:id="bldg_1"><gml:name>テスト</gml:name><bldg:lod1Solid><gml:Solid>
<gml:posList>${ring(3)}</gml:posList><gml:posList>${ring(33)}</gml:posList></gml:Solid></bldg:lod1Solid></bldg:Building></core:cityObjectMember>`;
    const bs = buildingsFromCityGml(gml, f, 't');
    expect(bs).toHaveLength(1);
    expect(bs[0].name).toBe('テスト');
    expect(bs[0].footprint).toHaveLength(4);
    expect(bs[0].zMin).toBeCloseTo(3, 1);
    expect(bs[0].zMax).toBeCloseTo(33, 1);
  });

  it('T-Y4 sky-view fraction: open sky 1, reduced next to a tall wall', () => {
    const opts = { halfSize: 60, gridSpacing: 10, heights: [2, 50], rayStep: 2, rayRange: 100, azimuths: 24, elevationMask: 15 };
    const open = computeSkyMap([], opts).map;
    expect(skyFractionAt(open, v3(0, 0, 2))).toBeCloseTo(1, 9);
    const wall: CityBuilding = { id: 'w', footprint: [{ x: 5, y: -60 }, { x: 15, y: -60 }, { x: 15, y: 60 }, { x: 5, y: 60 }], zMin: 0, zMax: 100, heightSource: 'plateau' };
    const m = computeSkyMap([wall], opts).map;
    const f = skyFractionAt(m, v3(0, 0, 2));
    expect(f).toBeLessThan(0.7);
    expect(f).toBeGreaterThan(0.4);
    expect(skyFractionAt(m, v3(10, 0, 2))).toBe(0);
  });

  it('T-Y5 wind power-law profile', () => {
    const spec = { mean: v3(4, 0, 0), gustStd: 0, gustTau: 3, profile: { refHeight: 10, exponent: 0.27, minHeight: 2 } };
    const w = createWind(spec, createRng(1));
    expect(w.step(0.01, 10).x).toBeCloseTo(4, 9);
    expect(w.step(0.01, 40).x).toBeCloseTo(4 * Math.pow(4, 0.27), 9);
    expect(w.step(0.01, 0).x).toBeCloseTo(4 * Math.pow(0.2, 0.27), 9);
    expect(createWind({ ...spec, profile: undefined }, createRng(1)).step(0.01, 40).x).toBe(4);
  });
});
