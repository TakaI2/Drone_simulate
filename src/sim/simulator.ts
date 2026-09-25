import type { Vec3 } from '../core/math';
import { qRotate, qToEuler, v3, vDist, vSub } from '../core/math';
import { MISSION_DEFAULTS, PLANNER_DEFAULTS } from '../core/presets';
import { createRng } from '../core/rng';
import type { CourseSpec, DroneParams, EnvironmentSpec } from '../core/types';
import { createController } from '../control/controller';
import type { ControlOutput, Setpoint } from '../control/controller';
import { astar, shortcutPath } from '../planning/astar';
import { createPathFollower } from '../planning/follower';
import type { PathFollower } from '../planning/follower';
import { buildVoxelGrid } from '../planning/voxel';
import { minObstacleDistance } from './collision';
import { createDynamics } from './dynamics';
import type { DroneState } from './dynamics';
import { createEstimator } from './estimator';
import type { EstimatorMode, StateEstimate } from './estimator';
import { createSensors } from './sensors';
import { createWind } from './wind';

export type MissionPhase = 'arming' | 'takeoff' | 'mission' | 'hover' | 'land' | 'landed' | 'manual' | 'crashed';

export interface SimConfig {
  params: DroneParams;
  env: EnvironmentSpec;
  course: CourseSpec;
  seed: number;
  estimator: EstimatorMode;
  idealSensors: boolean;
  initialSoc?: number;
  initialYaw?: number;
}

export interface SimSample {
  t: number;
  p: Vec3;
  v: Vec3;
  estP: Vec3;
  sp: Vec3;
  roll: number;
  pitch: number;
  yaw: number;
  u: number[];
  vbat: number;
  current: number;
  soc: number;
  wind: Vec3;
  phase: MissionPhase;
  clearance: number;
}

export interface SimEvent {
  t: number;
  kind: 'phase' | 'crash' | 'failsafe' | 'plan';
  detail: string;
}

export interface ManualInput {
  roll: number;
  pitch: number;
  yawRate: number;
  climbRate: number;
}

export interface Simulation {
  config: SimConfig;
  path: Vec3[];
  rawPath: Vec3[];
  /** Advance by one physics tick. */
  tick: () => void;
  /** Advance by `seconds` of simulated time (stops early if finished). */
  advance: (seconds: number) => void;
  runToEnd: (maxTime: number) => void;
  time: () => number;
  state: () => DroneState;
  estimate: () => StateEstimate;
  phase: () => MissionPhase;
  lastControl: () => ControlOutput | null;
  samples: SimSample[];
  events: SimEvent[];
  finished: () => boolean;
  crashed: () => boolean;
  setManual: (input: ManualInput | null) => void;
  setpoint: () => Vec3;
}

export const createSimulation = (config: SimConfig): Simulation => {
  const { params, env, course } = config;
  const M = MISSION_DEFAULTS;
  const rng = createRng(config.seed);
  const dyn = createDynamics(params, env);
  const ctrl = createController(params, env, dyn.coeffs);
  if (!ctrl.allocator.controllable) throw new Error('ロータ配置が制御不能です（配分行列のランク不足）');
  const wind = createWind(env.wind, rng);
  const sensors = createSensors(params.sensors, rng, config.idealSensors);
  let s = dyn.initialState(course.start, config.initialYaw ?? 0);
  s = { ...s, soc: config.initialSoc ?? 1 };
  const est = createEstimator(config.estimator, params.sensors, env.gravity, s);
  let e = est.current();
  const dt = 1 / params.physicsRateHz;
  const ctrlEvery = Math.max(1, Math.round(params.physicsRateHz / params.controlRateHz));
  const logEvery = Math.max(1, Math.round(params.physicsRateHz / M.logRateHz));

  // ---------- path ----------
  const takeoffPoint = v3(course.start.x, course.start.y, course.cruiseAltitude);
  const goalAir = v3(course.goal.x, course.goal.y, course.cruiseAltitude);
  const events: SimEvent[] = [];
  let rawPath: Vec3[] = [];
  let path: Vec3[];
  if (course.planPath) {
    const grid = buildVoxelGrid(course.obstacles, {
      min: env.boundsMin,
      max: env.boundsMax,
      res: PLANNER_DEFAULTS.resolution,
      inflate: params.collisionRadius + PLANNER_DEFAULTS.safetyMargin,
      floor: Math.min(PLANNER_DEFAULTS.floor, course.cruiseAltitude),
      ceilingMargin: PLANNER_DEFAULTS.ceilingMargin,
    });
    const plan = astar(grid, takeoffPoint, goalAir);
    if (!plan) throw new Error('経路が見つかりません（障害物で塞がれています）');
    rawPath = plan.path;
    path = shortcutPath(grid, plan.path);
    events.push({ t: 0, kind: 'plan', detail: `A*: 展開 ${plan.expanded} セル, ${rawPath.length} 点 → 短縮後 ${path.length} 点` });
  } else {
    path = [takeoffPoint, ...course.waypoints];
    const last = path[path.length - 1];
    if (vDist(last, goalAir) > 1e-6 && course.waypoints.length > 0) path.push(goalAir);
    rawPath = path;
  }

  const follower: PathFollower = createPathFollower(path, {
    cruiseSpeed: course.cruiseSpeed,
    accel: M.followerAccel,
    cornerSpeedFactor: M.cornerSpeedFactor,
    maxTrackingError: M.maxTrackingError,
  });

  // ---------- mission state ----------
  let t = 0;
  let tickCount = 0;
  let phase: MissionPhase = 'arming';
  let phaseStart = 0;
  let sp: Setpoint = { kind: 'idle' };
  let spPos = v3(course.start.x, course.start.y, 0);
  let holdPoint = takeoffPoint;
  let landedTimer = 0;
  let lowVoltTimer = 0;
  let failsafe = false;
  let crashed = false;
  let finished = false;
  let manual: ManualInput | null = null;
  let lastOut: ControlOutput | null = null;
  let u = new Array<number>(params.rotors.length).fill(0);
  const yaw0 = config.initialYaw ?? 0;
  const samples: SimSample[] = [];

  const setPhase = (p: MissionPhase, detail = ''): void => {
    phase = p;
    phaseStart = t;
    events.push({ t, kind: 'phase', detail: `${p}${detail ? ` (${detail})` : ''}` });
  };
  events.push({ t: 0, kind: 'phase', detail: 'arming' });

  const crash = (reason: string): void => {
    if (crashed) return;
    crashed = true;
    finished = true;
    events.push({ t, kind: 'crash', detail: reason });
    setPhase('crashed', reason);
  };

  const updateMission = (): void => {
    const elapsed = t - phaseStart;
    const airborne = !s.onGround;
    // failsafe: low battery under load
    const cellV = e.vbat / params.battery.cells;
    if (airborne && !failsafe && phase !== 'land' && phase !== 'landed') {
      lowVoltTimer = cellV < params.landCellVoltage ? lowVoltTimer + ctrlEvery * dt : 0;
      if (lowVoltTimer >= M.failsafeHoldTime) {
        failsafe = true;
        events.push({ t, kind: 'failsafe', detail: `セル電圧 ${cellV.toFixed(2)} V < ${params.landCellVoltage} V → 自動着陸` });
        holdPoint = v3(e.p.x, e.p.y, e.p.z);
        setPhase('land', '低電圧');
      }
    }
    if (manual) {
      if (phase !== 'manual') setPhase('manual');
      sp = { kind: 'manual', ...manual };
      spPos = e.p;
      return;
    }
    switch (phase) {
      case 'arming':
        sp = { kind: 'idle' };
        if (elapsed >= M.armDelay) setPhase('takeoff');
        break;
      case 'takeoff': {
        const z = Math.min(takeoffPoint.z, params.gearHeight + M.takeoffSpeed * elapsed);
        spPos = v3(takeoffPoint.x, takeoffPoint.y, z);
        sp = { kind: 'position', pos: spPos, velFF: v3(0, 0, z < takeoffPoint.z ? M.takeoffSpeed : 0), accFF: v3(), yaw: yaw0 };
        if (z >= takeoffPoint.z && vDist(e.p, takeoffPoint) < M.arriveTolerance * 2) setPhase('mission');
        break;
      }
      case 'mission': {
        const f = follower.step(e.p, ctrlEvery * dt);
        spPos = f.pos;
        sp = { kind: 'position', pos: f.pos, velFF: f.vel, accFF: v3(), yaw: yaw0 };
        if (f.done && vDist(e.p, f.pos) < M.arriveTolerance * 2) {
          holdPoint = f.pos;
          setPhase('hover');
        }
        break;
      }
      case 'hover':
        spPos = holdPoint;
        sp = { kind: 'position', pos: holdPoint, velFF: v3(), accFF: v3(), yaw: yaw0 };
        if (elapsed >= course.hoverTime) {
          if (course.land) setPhase('land');
          else finished = true;
        }
        break;
      case 'land': {
        const z = Math.max(-0.3, holdPoint.z - M.landSpeed * elapsed);
        spPos = v3(holdPoint.x, holdPoint.y, z);
        sp = { kind: 'position', pos: spPos, velFF: v3(0, 0, -M.landSpeed), accFF: v3(), yaw: yaw0 };
        landedTimer = s.onGround && Math.abs(s.v.z) < 0.1 ? landedTimer + ctrlEvery * dt : 0;
        if (landedTimer >= M.landedHoldTime) setPhase('landed');
        break;
      }
      case 'landed':
        sp = { kind: 'idle' };
        if (elapsed > 0.5) finished = true;
        break;
      default:
        sp = { kind: 'idle' };
    }
  };

  const tick = (): void => {
    if (finished) return;
    const w = wind.step(dt);
    const res = dyn.step(s, u, w, dt);
    s = res.state;
    t += dt;
    tickCount++;
    const reading = sensors.read(s, env.gravity, dt);
    e = est.update(reading, s, dt);

    // crash detection
    if (res.diag.impactSpeed !== null && res.diag.impactSpeed < -M.crashImpactSpeed)
      crash(`地面に ${(-res.diag.impactSpeed).toFixed(2)} m/s で衝突`);
    const up = qRotate(s.q, v3(0, 0, 1));
    if (s.onGround && Math.acos(Math.min(1, up.z)) > M.crashTiltRad) crash('接地時に転倒');
    const near = minObstacleDistance(s.p, course.obstacles);
    if (near.distance < params.collisionRadius) crash(`障害物 ${near.id} に接触`);
    const out = s.p.x < env.boundsMin.x || s.p.y < env.boundsMin.y || s.p.x > env.boundsMax.x || s.p.y > env.boundsMax.y || s.p.z > env.boundsMax.z;
    if (out) crash('飛行空間の外に出た');

    if (tickCount % ctrlEvery === 0 && !crashed) {
      updateMission();
      const landedFlag = s.onGround && (phase === 'takeoff' ? t - phaseStart < 0.3 : phase !== 'mission' && phase !== 'hover');
      lastOut = ctrl.update(e, sp, ctrlEvery * dt, landedFlag);
      u = lastOut.u;
    }
    if (crashed) u = u.map(() => 0);

    if (tickCount % logEvery === 0) {
      const eul = qToEuler(s.q);
      samples.push({
        t,
        p: s.p,
        v: s.v,
        estP: e.p,
        sp: spPos,
        roll: eul.roll,
        pitch: eul.pitch,
        yaw: eul.yaw,
        u: [...u],
        vbat: s.batteryVoltage,
        current: s.batteryCurrent,
        soc: s.soc,
        wind: w,
        phase,
        clearance: near.distance - params.collisionRadius,
      });
    }
  };

  const advance = (seconds: number): void => {
    const n = Math.round(seconds / dt);
    for (let i = 0; i < n && !finished; i++) tick();
  };

  return {
    config,
    path,
    rawPath,
    tick,
    advance,
    runToEnd: (maxTime: number) => {
      while (!finished && t < maxTime) tick();
    },
    time: () => t,
    state: () => s,
    estimate: () => e,
    phase: () => phase,
    lastControl: () => lastOut,
    samples,
    events,
    finished: () => finished,
    crashed: () => crashed,
    setManual: (input) => {
      manual = input;
      if (!input && phase === 'manual') {
        holdPoint = v3(e.p.x, e.p.y, e.p.z);
        setPhase('hover');
      }
    },
    setpoint: () => vSub(spPos, v3()),
  };
};
