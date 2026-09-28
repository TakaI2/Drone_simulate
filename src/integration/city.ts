import { v3, vDist } from '../core/math';
import type { Vec3 } from '../core/math';
import { CITY_AREA_MINATOMIRAI, CITY_PLANNER, ENV_OUTDOOR_C, GNSS_URBAN, MISSION_DEFAULTS, WIND_PROFILE_URBAN } from '../core/presets';
import type { CourseSpec, EnvironmentSpec, SkyMap } from '../core/types';
import { buildingsFromCityGml, buildingsFromOverpass, centroidOf, clipBuildings, median, toObstacles } from '../geo/city';
import type { CityBuilding, OverpassElement, XY } from '../geo/city';
import { createEnuFrame } from '../geo/enu';
import { computeSkyMap } from '../geo/skyview';
import { distanceToPolygon2d, pointInPolygon } from '../sim/collision';
import type { Simulation } from '../sim/simulator';
import type { Criterion, ScenarioDef } from '../sim/scenarios';
import { skyFractionAt } from '../sim/urban';

export type CityArea = typeof CITY_AREA_MINATOMIRAI;

export interface CityModel {
  area: { name: string; origin: { lat: number; lon: number }; halfSize: number };
  /** Ground reference: median PLATEAU building base elevation [m]. */
  groundElevation: number;
  plateau: CityBuilding[];
  osm: CityBuilding[];
  parks: Array<{ name: string; ring: XY[] }>;
}

/** Convert raw sources (PLATEAU GML texts, Overpass elements) into the local city model. */
export const buildCityModel = (area: CityArea, gmls: Array<{ mesh: string; gml: string }>, osm: OverpassElement[]): CityModel => {
  const frame = createEnuFrame({ ...area.origin, h: 0 });
  const allPlateau = gmls.flatMap((g) => buildingsFromCityGml(g.gml, frame, `plateau-${g.mesh}`));
  const groundElevation = median(allPlateau.map((b) => b.zMin));
  const parks = osm
    .filter((e) => e.tags?.leisure === 'park')
    .flatMap((e) => {
      const rings = e.geometry ? [e.geometry] : (e.members ?? []).filter((m) => m.role === 'outer' && m.geometry).map((m) => m.geometry ?? []);
      return rings.map((r) => ({ name: e.tags?.name ?? '（名称なし）', ring: r.map((n) => frame.toEnu({ lat: n.lat, lon: n.lon, h: 0 })).map((p) => ({ x: p.x, y: p.y })) }));
    });
  return {
    area: { name: area.name, origin: { ...area.origin }, halfSize: area.halfSize },
    groundElevation,
    plateau: clipBuildings(allPlateau, area.halfSize, groundElevation),
    osm: clipBuildings(buildingsFromOverpass(osm, frame), area.halfSize, 0),
    parks,
  };
};

export interface HeightMatch {
  name: string;
  plateau: number;
  osm: number;
  osmSource: string;
}

/** Pair buildings whose PLATEAU footprint contains the OSM centroid, compare heights. */
export const compareHeights = (m: CityModel): HeightMatch[] => {
  const out: HeightMatch[] = [];
  for (const o of m.osm) {
    const c = centroidOf(o.footprint);
    const p = m.plateau.find((b) => pointInPolygon(c.x, c.y, b.footprint));
    if (p) out.push({ name: o.name ?? p.name ?? o.id, plateau: p.zMax, osm: o.zMax, osmSource: o.heightSource });
  }
  return out;
};

/** Mission endpoints and flight settings of the city route (local ENU). */
export const CITY_ROUTE = {
  name: 'みなとみらい横断（南西 → 北東）',
  start: v3(-330, -330, 0),
  goal: v3(340, 360, 0),
  cruiseAltitude: 40,
  cruiseSpeed: 5,
  maxTrackingError: 3,
  meanWind: 3,
  gustStd: 1,
} as const;

export const cityCourse = (m: CityModel, source: 'plateau' | 'osm', safetyMargin: number): CourseSpec => ({
  name: `${CITY_ROUTE.name}（${source === 'plateau' ? 'PLATEAU' : 'OSM'}）`,
  start: CITY_ROUTE.start,
  goal: CITY_ROUTE.goal,
  waypoints: [],
  cruiseAltitude: CITY_ROUTE.cruiseAltitude,
  cruiseSpeed: CITY_ROUTE.cruiseSpeed,
  planPath: true,
  obstacles: toObstacles(source === 'plateau' ? m.plateau : m.osm),
  hoverTime: 3,
  land: true,
  maxTrackingError: CITY_ROUTE.maxTrackingError,
  planner: { resolution: CITY_PLANNER.resolution, safetyMargin },
});

export const cityEnv = (m: CityModel, urban: { sky?: SkyMap; profile: boolean }): EnvironmentSpec => {
  const base = ENV_OUTDOOR_C(CITY_ROUTE.meanWind, CITY_ROUTE.gustStd);
  return {
    ...base,
    wind: { ...base.wind, ...(urban.profile ? { profile: { ...WIND_PROFILE_URBAN } } : {}) },
    boundsMin: v3(-m.area.halfSize, -m.area.halfSize, 0),
    boundsMax: v3(m.area.halfSize, m.area.halfSize, CITY_PLANNER.ceiling),
    ...(urban.sky ? { gnssSky: urban.sky } : {}),
  };
};

export const citySkyMap = (m: CityModel): SkyMap => computeSkyMap(m.plateau, { halfSize: m.area.halfSize, ...GNSS_URBAN }).map;

const crit = (label: string, value: number, limit: number, unit: string, op: 'lt' | 'gte' = 'lt'): Criterion => ({ label, value, limit, unit, op, pass: op === 'lt' ? value < limit : value >= limit });

/** Landing tolerance for the city route [m] (urban GNSS error near buildings is several metres). */
export const CITY_LIMITS = { landing: 5 } as const;

export const cityEvaluate = (sim: Simulation): Criterion[] => {
  const last = sim.samples[sim.samples.length - 1];
  const g = sim.config.course.goal;
  const landed = sim.samples.some((s) => s.phase === 'landed');
  const minClear = sim.samples.filter((s) => s.phase !== 'landed').reduce((mn, s) => Math.min(mn, s.clearance), Infinity);
  return [
    crit('墜落・接触', sim.crashed() ? 1 : 0, 1, '回'),
    crit('着陸完了', landed ? 1 : 0, 1, '', 'gte'),
    crit('着陸位置誤差', Math.hypot(last.p.x - g.x, last.p.y - g.y), CITY_LIMITS.landing, 'm'),
    crit('建物との最小距離', minClear, 0, 'm', 'gte'),
  ];
};

export const cityScenario = (id: string, title: string, description: string, course: () => CourseSpec, env: () => EnvironmentSpec): ScenarioDef => ({
  id,
  title,
  description,
  course,
  env,
  maxTime: 900,
  evaluate: cityEvaluate,
});

/** Position error statistics along a flight, split by open-sky fraction. */
export const gnssErrorBySky = (sim: Simulation, sky: SkyMap): Array<{ band: string; n: number; rms: number }> => {
  const bands = [
    { band: 'f ≥ 0.8（開けた空）', lo: 0.8, hi: 2 },
    { band: '0.6 ≤ f < 0.8', lo: 0.6, hi: 0.8 },
    { band: '0.4 ≤ f < 0.6', lo: 0.4, hi: 0.6 },
    { band: 'f < 0.4（ビル谷間）', lo: -1, hi: 0.4 },
  ];
  return bands.map((b) => {
    const e = sim.samples.filter((s) => s.phase !== 'landed' && s.phase !== 'arming').filter((s) => {
      const f = skyFractionAt(sky, s.p);
      return f >= b.lo && f < b.hi;
    });
    const rms = Math.sqrt(e.reduce((a, s) => a + (s.estP.x - s.p.x) ** 2 + (s.estP.y - s.p.y) ** 2, 0) / Math.max(1, e.length));
    return { band: b.band, n: e.length, rms: e.length ? rms : NaN };
  });
};

// ------------------------------------------------------------------ legal checks

export interface LegalItem {
  item: string;
  status: 'ok' | 'warn' | 'info';
  detail: string;
}

/** Route-level legal notes (Japan). `path` is the planned path; `massG` decides which rules apply. */
export const legalChecks = (m: CityModel, path: Vec3[], massG: number, altitudeLimit = 150): LegalItem[] => {
  const out: LegalItem[] = [];
  const maxZ = Math.max(...path.map((p) => p.z));
  out.push({ item: '飛行高度（地表から 150 m 未満）', status: maxZ < altitudeLimit ? 'ok' : 'warn', detail: `経路の最高高度 ${maxZ.toFixed(0)} m` });
  const hits = new Set<string>();
  const near = new Set<string>();
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    const n = Math.max(1, Math.ceil(vDist(a, b) / 2));
    for (let k = 0; k <= n; k++) {
      const x = a.x + ((b.x - a.x) * k) / n, y = a.y + ((b.y - a.y) * k) / n;
      for (const pk of m.parks) {
        if (pointInPolygon(x, y, pk.ring)) hits.add(pk.name);
        else if (distanceToPolygon2d(x, y, pk.ring) < MISSION_DEFAULTS.parkWarnDistance) near.add(pk.name);
      }
    }
  }
  out.push({
    item: '公園の上空（横浜市は市管理公園でのドローン飛行を原則禁止）',
    status: hits.size ? 'warn' : 'ok',
    detail: hits.size ? `通過: ${[...hits].join('、')}（公園管理者の許可が必要か要確認）` : `通過なし${near.size ? `（近接: ${[...near].join('、')}）` : ''}`,
  });
  out.push({
    item: '人口集中地区（DID）',
    status: massG >= 100 ? 'warn' : 'info',
    detail: `みなとみらい地区は人口集中地区内（国勢調査の境界データで要確認）。${massG >= 100 ? '100 g 以上の機体は国土交通大臣の許可が必要' : `本機 ${massG.toFixed(1)} g は 100 g 未満のため航空法の許可対象外。ただし土地管理者・条例の確認は必要`}`,
  });
  out.push({ item: '小型無人機等飛行禁止法（重要施設周辺）', status: 'info', detail: '対象施設（警察庁・国交省の公示）の周辺 300 m に当たらないか飛行前に確認' });
  out.push({ item: '第三者・建物との距離', status: 'info', detail: '建物からの最小距離は計画の安全余裕で確保。人の上空を飛ばない運用が前提' });
  return out;
};
