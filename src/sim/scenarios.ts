import type { Vec3 } from '../core/math';
import { vDist } from '../core/math';
import { COURSE_HOVER, COURSE_OBSTACLES, COURSE_OUTDOOR_C_HOVER, COURSE_OUTDOOR_HOVER, COURSE_OUTDOOR_RTH, COURSE_OUTDOOR_SQUARE, COURSE_OUTDOOR_WIDE, COURSE_SQUARE, ENV_CALM, ENV_OUTDOOR, ENV_OUTDOOR_C, ENV_WINDY } from '../core/presets';
import type { CourseSpec, DroneParams, EnvironmentSpec } from '../core/types';
import { createSimulation } from './simulator';
import type { SimConfig, SimSample, Simulation } from './simulator';

export interface Criterion {
  label: string;
  value: number;
  limit: number;
  unit: string;
  /** 'lt' = value must be < limit, 'gte' = value must be >= limit. */
  op: 'lt' | 'gte';
  pass: boolean;
}

export interface ScenarioResult {
  id: string;
  title: string;
  description: string;
  criteria: Criterion[];
  pass: boolean;
  duration: number;
  crashed: boolean;
  events: string[];
  sim: Simulation;
}

export interface ScenarioDef {
  id: string;
  title: string;
  description: string;
  course: () => CourseSpec;
  env: () => EnvironmentSpec;
  maxTime: number;
  initialSoc?: number;
  evaluate: (sim: Simulation) => Criterion[];
}

const crit = (label: string, value: number, limit: number, unit: string, op: 'lt' | 'gte' = 'lt'): Criterion => ({
  label,
  value,
  limit,
  unit,
  op,
  pass: op === 'lt' ? value < limit : value >= limit,
});

const inPhase = (s: SimSample[], phase: SimSample['phase']): SimSample[] => s.filter((x) => x.phase === phase);

/** Hover window starts after takeoff overshoot has settled. */
const HOVER_SETTLE_TIME = 2;

export const minDistanceToPoint = (samples: SimSample[], p: Vec3): number =>
  samples.reduce((m, s) => Math.min(m, vDist(s.p, p)), Infinity);

export const SCENARIOS: ScenarioDef[] = [
  {
    id: 'G1-1',
    title: 'ホバリング精度',
    description: '高度 1 m で 10 秒ホバリング（センサノイズ・推定器あり、無風）',
    course: COURSE_HOVER,
    env: ENV_CALM,
    maxTime: 20,
    evaluate: (sim) => {
      const hover = inPhase(sim.samples, 'hover');
      const t0 = hover.length ? hover[0].t + HOVER_SETTLE_TIME : 0;
      const win = hover.filter((s) => s.t >= t0);
      const rms = Math.sqrt(win.reduce((a, s) => a + (s.p.z - s.sp.z) ** 2, 0) / Math.max(1, win.length));
      const horiz = win.reduce((m, s) => Math.max(m, Math.hypot(s.p.x - s.sp.x, s.p.y - s.sp.y)), 0);
      return [crit('高度誤差 RMS', win.length ? rms : Infinity, 0.05, 'm'), crit('水平誤差 最大', win.length ? horiz : Infinity, 0.15, 'm'), crit('墜落', sim.crashed() ? 1 : 0, 1, '回'), crit('ホバリング到達', win.length > 0 ? 1 : 0, 1, '', 'gte')];
    },
  },
  {
    id: 'G1-2',
    title: '経由点飛行',
    description: '2 m 四方の正方形コースを経由点どおりに飛行し着陸',
    course: COURSE_SQUARE,
    env: ENV_CALM,
    maxTime: 40,
    evaluate: (sim) => {
      const wps = sim.config.course.waypoints;
      const worst = wps.reduce((m, w) => Math.max(m, minDistanceToPoint(sim.samples, w)), 0);
      const landed = sim.phase() === 'landed' || sim.samples.some((s) => s.phase === 'landed');
      return [crit('経由点の最大通過誤差', worst, 0.15, 'm'), crit('着陸完了', landed ? 1 : 0, 1, '', 'gte'), crit('墜落', sim.crashed() ? 1 : 0, 1, '回')];
    },
  },
  {
    id: 'G1-3',
    title: '障害物コース自律飛行',
    description: '壁・柱・机・梁のある空間を A* で経路計画し、目標点へ飛行して着陸',
    course: COURSE_OBSTACLES,
    env: ENV_CALM,
    maxTime: 60,
    evaluate: (sim) => {
      const goal = sim.config.course.goal;
      const last = sim.samples[sim.samples.length - 1];
      const goalErr = Math.hypot(last.p.x - goal.x, last.p.y - goal.y);
      const minClear = sim.samples.reduce((m, s) => Math.min(m, s.clearance), Infinity);
      return [
        crit('衝突', sim.crashed() ? 1 : 0, 1, '回'),
        crit('目標到達誤差（水平）', goalErr, 0.2, 'm'),
        crit('最小クリアランス', minClear, 0.05, 'm', 'gte'),
      ];
    },
  },
  {
    id: 'G1-4',
    title: '耐風ホバリング',
    description: '平均風 3 m/s（東向き）＋突風 σ=1 m/s の中で高度 1 m に保持',
    course: () => ({ ...COURSE_HOVER(), hoverTime: 20 }),
    env: ENV_WINDY,
    maxTime: 30,
    evaluate: (sim) => {
      const hover = inPhase(sim.samples, 'hover');
      const t0 = hover.length ? hover[0].t + HOVER_SETTLE_TIME : 0;
      const win = hover.filter((s) => s.t >= t0);
      const maxH = win.reduce((m, s) => Math.max(m, Math.hypot(s.p.x - s.sp.x, s.p.y - s.sp.y)), 0);
      return [crit('水平位置誤差 最大', win.length ? maxH : Infinity, 0.5, 'm'), crit('墜落', sim.crashed() ? 1 : 0, 1, '回'), crit('ホバリング到達', win.length > 0 ? 1 : 0, 1, '', 'gte')];
    },
  },
  {
    id: 'G1-5',
    title: '低電圧フェイルセーフ',
    description: '残量 12 % から離陸しホバリング継続 → 電圧低下で自動着陸',
    course: () => ({ ...COURSE_HOVER(), hoverTime: 600 }),
    env: ENV_CALM,
    maxTime: 400,
    initialSoc: 0.12,
    evaluate: (sim) => {
      const failsafe = sim.events.some((e) => e.kind === 'failsafe');
      const landed = sim.samples.some((s) => s.phase === 'landed');
      return [crit('フェイルセーフ発動', failsafe ? 1 : 0, 1, '', 'gte'), crit('着陸完了', landed ? 1 : 0, 1, '', 'gte'), crit('墜落', sim.crashed() ? 1 : 0, 1, '回')];
    },
  },
];

/**
 * Outdoor GNSS scenarios (variant B with a GNSS + compass module attached).
 * Limits reflect consumer GNSS (~1 m CEP): the vehicle can only be as accurate as its position fix.
 */
export const OUTDOOR_LIMITS = { hoverHoriz: 3.0, hoverAltRms: 1.0, waypoint: 3.0, landing: 3.0 } as const;

export const OUTDOOR_SCENARIOS: ScenarioDef[] = [
  {
    id: 'GB-5a',
    title: '屋外ホバリング（GNSS・風 3 m/s＋突風）',
    description: '高度 5 m で 30 秒ホバリング。位置は GNSS（ゆっくり変動する約 1 m の誤差）、高度は気圧計',
    course: COURSE_OUTDOOR_HOVER,
    env: ENV_OUTDOOR,
    maxTime: 60,
    evaluate: (sim) => evalOutdoorHover(sim),
  },
  {
    id: 'GB-5b',
    title: '屋外 20 m 四方の経由点飛行（GNSS）',
    description: '高度 5 m、1.5 m/s で 20 m 四方を周回し出発点に着陸（風 3 m/s＋突風）',
    course: COURSE_OUTDOOR_SQUARE,
    env: ENV_OUTDOOR,
    maxTime: 150,
    evaluate: (sim) => evalOutdoorRoute(sim),
  },
];

/** Hover window after settling: max horizontal error and altitude RMS. */
export const hoverStats = (sim: Simulation): { maxH: number; altRms: number; n: number } => {
  const hover = inPhase(sim.samples, 'hover');
  const t0 = hover.length ? hover[0].t + HOVER_SETTLE_TIME : 0;
  const win = hover.filter((s) => s.t >= t0);
  const maxH = win.reduce((m, s) => Math.max(m, Math.hypot(s.p.x - s.sp.x, s.p.y - s.sp.y)), 0);
  const altRms = Math.sqrt(win.reduce((a, s) => a + (s.p.z - s.sp.z) ** 2, 0) / Math.max(1, win.length));
  return { maxH: win.length ? maxH : Infinity, altRms: win.length ? altRms : Infinity, n: win.length };
};

function evalOutdoorHover(sim: Simulation, horizLimit: number = OUTDOOR_LIMITS.hoverHoriz): Criterion[] {
  const h = hoverStats(sim);
  return [
    crit('水平位置誤差 最大', h.maxH, horizLimit, 'm'),
    crit('高度誤差 RMS', h.altRms, OUTDOOR_LIMITS.hoverAltRms, 'm'),
    crit('墜落', sim.crashed() ? 1 : 0, 1, '回'),
    crit('ホバリング到達', h.n > 0 ? 1 : 0, 1, '', 'gte'),
  ];
}

function landingStats(sim: Simulation, target: Vec3): { landed: boolean; landErr: number } {
  const landed = sim.samples.some((s) => s.phase === 'landed');
  const last = sim.samples[sim.samples.length - 1];
  return { landed, landErr: Math.hypot(last.p.x - target.x, last.p.y - target.y) };
}

function evalOutdoorRoute(sim: Simulation): Criterion[] {
  const wps = sim.config.course.waypoints;
  const worst = wps.reduce((m, w) => Math.max(m, minDistanceToPoint(sim.samples, w)), 0);
  const l = landingStats(sim, sim.config.course.goal);
  return [
    crit('経由点の最大通過誤差', worst, OUTDOOR_LIMITS.waypoint, 'm'),
    crit('着陸位置誤差', l.landErr, OUTDOOR_LIMITS.landing, 'm'),
    crit('着陸完了', l.landed ? 1 : 0, 1, '', 'gte'),
    crit('墜落', sim.crashed() ? 1 : 0, 1, '回'),
  ];
}

/** Variant C: stronger wind, wider route, return-to-home failsafe. */
export const OUTDOOR_C_LIMITS = { strongWindHoriz: 4.0, windSweepHoriz: 3.0 } as const;

export const OUTDOOR_C_SCENARIOS: ScenarioDef[] = [
  {
    id: 'GC-5a',
    title: '屋外ホバリング（GNSS・平均風 5 m/s＋突風）',
    description: '高度 5 m で 30 秒ホバリング。平均風 5 m/s、突風 σ1.5 m/s（瞬間 8 m/s 程度）',
    course: COURSE_OUTDOOR_C_HOVER,
    env: () => ENV_OUTDOOR_C(5, 1.5),
    maxTime: 70,
    evaluate: (sim) => evalOutdoorHover(sim),
  },
  {
    id: 'GC-5b',
    title: '屋外 40 m 四方の経由点飛行（高度 10 m・4 m/s）',
    description: '平均風 5 m/s＋突風の中、40 m 四方を 4 m/s で周回して出発点に着陸',
    course: COURSE_OUTDOOR_WIDE,
    env: () => ENV_OUTDOOR_C(5, 1.5),
    maxTime: 200,
    evaluate: (sim) => evalOutdoorRoute(sim),
  },
  {
    id: 'GC-5c',
    title: '強風ホバリング（平均風 8 m/s＋突風）',
    description: '高度 5 m で 30 秒ホバリング。平均風 8 m/s、突風 σ2 m/s（瞬間 12 m/s 程度）。位置誤差 4 m 以内',
    course: COURSE_OUTDOOR_C_HOVER,
    env: () => ENV_OUTDOOR_C(8, 2),
    maxTime: 70,
    evaluate: (sim) => evalOutdoorHover(sim, OUTDOOR_C_LIMITS.strongWindHoriz),
  },
  {
    id: 'GC-6',
    title: '通信断からの自動帰還（RTH）',
    description: '30 m 先へ向かう途中（t=32 s）で通信断 → 高度 12 m に上昇してホームへ戻り着陸（平均風 5 m/s）',
    course: COURSE_OUTDOOR_RTH,
    env: () => ENV_OUTDOOR_C(5, 1.5),
    maxTime: 150,
    evaluate: (sim) => {
      const fired = sim.events.some((e) => e.kind === 'failsafe' && e.detail.startsWith('通信断'));
      const rth = sim.samples.some((s) => s.phase === 'rth');
      const l = landingStats(sim, sim.config.course.start);
      return [
        crit('フェイルセーフ発動', fired ? 1 : 0, 1, '', 'gte'),
        crit('帰還飛行', rth ? 1 : 0, 1, '', 'gte'),
        crit('ホームからの着陸位置誤差', l.landErr, OUTDOOR_LIMITS.landing, 'm'),
        crit('着陸完了', l.landed ? 1 : 0, 1, '', 'gte'),
        crit('墜落', sim.crashed() ? 1 : 0, 1, '回'),
      ];
    },
  },
];

export interface WindSweepPoint {
  wind: number;
  /** Worst hover error over the seeds (Infinity if crashed / never hovered) [m]. */
  maxH: number;
  crashes: number;
  pass: boolean;
}

/** Hover at increasing mean wind; the wind limit is the highest wind where every seed stays within the limit. */
export const windSweep = (params: DroneParams, winds: number[], seeds: number[], gustRatio = 0.25, limit: number = OUTDOOR_C_LIMITS.windSweepHoriz): { points: WindSweepPoint[]; limit: number } => {
  const points: WindSweepPoint[] = [];
  for (const w of winds) {
    let maxH = 0, crashes = 0;
    for (const seed of seeds) {
      const sim = createSimulation({ params, env: ENV_OUTDOOR_C(w, w * gustRatio), course: COURSE_OUTDOOR_C_HOVER(), seed, estimator: 'filter', idealSensors: false });
      sim.runToEnd(70);
      if (sim.crashed()) crashes++;
      maxH = Math.max(maxH, hoverStats(sim).maxH);
    }
    points.push({ wind: w, maxH, crashes, pass: crashes === 0 && maxH < limit });
  }
  let lim = 0;
  for (const p of points) {
    if (!p.pass) break;
    lim = p.wind;
  }
  return { points, limit: lim };
};

export interface RunOptions {
  /** True vehicle for sim-to-real studies (controller keeps using `params`). */
  plant?: DroneParams;
  seed?: number;
  estimator?: SimConfig['estimator'];
  idealSensors?: boolean;
}

export const runScenario = (def: ScenarioDef, params: DroneParams, o: RunOptions = {}): ScenarioResult => {
  const sim = createSimulation({
    params,
    plant: o.plant,
    env: def.env(),
    course: def.course(),
    seed: o.seed ?? 42,
    estimator: o.estimator ?? 'filter',
    idealSensors: o.idealSensors ?? false,
    initialSoc: def.initialSoc,
  });
  sim.runToEnd(def.maxTime);
  const criteria = def.evaluate(sim);
  return {
    id: def.id,
    title: def.title,
    description: def.description,
    criteria,
    pass: criteria.every((c) => c.pass),
    duration: sim.time(),
    crashed: sim.crashed(),
    events: sim.events.map((e) => `${e.t.toFixed(2)}s [${e.kind}] ${e.detail}`),
    sim,
  };
};

export interface HoverMargin {
  wind: number;
  /** 99th percentile of the motor commands while hovering (0..1). */
  uP99: number;
  /** Share of hover samples with a saturated motor. */
  saturation: number;
  meanCurrent: number;
  /** Hover endurance extrapolated from the mean current (usable capacity 80 %) [min]. */
  enduranceMin: number;
  maxTiltDeg: number;
  maxH: number;
  altRms: number;
  crashed: boolean;
}

/** Thrust margin and endurance of a GNSS hover at a given mean wind (gust σ = gustRatio × mean). */
export const hoverMargin = (params: DroneParams, wind: number, seed: number, gustRatio = 0.25, usable = 0.8): HoverMargin => {
  const sim = createSimulation({ params, env: ENV_OUTDOOR_C(wind, wind * gustRatio), course: COURSE_OUTDOOR_C_HOVER(), seed, estimator: 'filter', idealSensors: false });
  sim.runToEnd(70);
  const hov = inPhase(sim.samples, 'hover');
  const us = hov.flatMap((s) => s.u).sort((a, b) => a - b);
  const meanCurrent = hov.reduce((a, s) => a + s.current, 0) / Math.max(1, hov.length);
  const h = hoverStats(sim);
  return {
    wind,
    uP99: us.length ? us[Math.min(us.length - 1, Math.floor(us.length * 0.99))] : Infinity,
    saturation: hov.filter((s) => s.u.some((u) => u >= 0.999)).length / Math.max(1, hov.length),
    meanCurrent,
    enduranceMin: meanCurrent > 0 ? ((usable * params.battery.capacityAh) / meanCurrent) * 60 : 0,
    maxTiltDeg: (hov.reduce((m, s) => Math.max(m, Math.hypot(s.roll, s.pitch)), 0) * 180) / Math.PI,
    maxH: h.maxH,
    altRms: h.altRms,
    crashed: sim.crashed(),
  };
};
