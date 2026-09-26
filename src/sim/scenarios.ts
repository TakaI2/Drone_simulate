import type { Vec3 } from '../core/math';
import { vDist } from '../core/math';
import { COURSE_HOVER, COURSE_OBSTACLES, COURSE_SQUARE, ENV_CALM, ENV_WINDY } from '../core/presets';
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
