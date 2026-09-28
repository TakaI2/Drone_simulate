import * as THREE from 'three';
import { v3 } from '../core/math';
import type { Vec3 } from '../core/math';
import { COURSE_PRESETS, ENV_CALM } from '../core/presets';
import type { CourseSpec, DroneParams, EnvironmentSpec, Obstacle } from '../core/types';
import { CHART_CSS, lineChartSvg } from '../report/chart';
import { OUTDOOR_C_SCENARIOS, OUTDOOR_SCENARIOS, SCENARIOS, runScenario } from '../sim/scenarios';
import type { ScenarioDef } from '../sim/scenarios';
import { createSimulation } from '../sim/simulator';
import type { Simulation } from '../sim/simulator';
import { buildDroneMesh } from './drone-mesh';
import type { DroneMesh } from './drone-mesh';
import { buildCourseGroup, createTrail, polyline } from './scene-objects';
import { createViewport } from './viewport';
import { button, checkField, el, heading, markReady, numberField, selectField } from './widgets';

export interface SimViewOptions {
  query: URLSearchParams;
  drones: Record<string, { label: string; build: () => DroneParams }>;
  /** Optional detailed mesh factory (e.g. assembled design from stage 5). */
  meshFactory?: (droneKey: string, p: DroneParams) => DroneMesh | null;
  initialDrone?: string;
  /** Extra goal scenarios listed in the side panel (variant C outdoor scenarios, city). */
  scenarios?: ScenarioDef[];
  /** Initial course / environment (city view). */
  initialCourse?: CourseSpec;
  initialEnv?: EnvironmentSpec;
}

const isVec = (x: Vec3 | null | undefined): x is Vec3 =>
  !!x && typeof x.x === 'number' && typeof x.y === 'number' && typeof x.z === 'number';

/** Validate user-edited course JSON. */
export const parseCourse = (text: string, fallback: CourseSpec): CourseSpec => {
  const raw = JSON.parse(text) as Partial<CourseSpec>;
  if (!isVec(raw.start) || !isVec(raw.goal)) throw new Error('start / goal が不正です');
  const obstacles: Obstacle[] = (raw.obstacles ?? []).map((o, i) => {
    if (o.kind === 'box' && isVec(o.center) && isVec(o.size)) return { ...o, id: o.id ?? `box-${i}` };
    if (o.kind === 'cylinder' && isVec(o.base) && typeof o.radius === 'number' && typeof o.height === 'number') return { ...o, id: o.id ?? `cyl-${i}` };
    if (o.kind === 'prism' && Array.isArray(o.footprint) && o.footprint.length >= 3 && o.footprint.every((q) => typeof q.x === 'number' && typeof q.y === 'number') && typeof o.zMin === 'number' && typeof o.zMax === 'number') return { ...o, id: o.id ?? `prism-${i}` };
    throw new Error(`obstacles[${i}] が不正です`);
  });
  return {
    ...fallback,
    ...raw,
    waypoints: (raw.waypoints ?? []).filter(isVec),
    obstacles,
  } as CourseSpec;
};

type CameraMode = 'free' | 'orbit' | 'chase' | 'top';

/** Follow-camera tuning: distance [m], chase height ratio, smoothing rate [1/s]. */
const CAMERA_FOLLOW = { defaultDistance: 4, chaseHeight: 0.35, topHeight: 2.5, smoothing: 4, minSpeedForHeading: 0.5 } as const;

/** Select value of the course passed in by the caller (city view). */
const INITIAL_COURSE_KEY = '__initial';

export const mountSimView = (root: HTMLElement, o: SimViewOptions): (() => void) => {
  const style = el('style', { text: CHART_CSS });
  document.head.append(style);
  const q = o.query;
  const state = {
    droneKey: q.get('drone') ?? o.initialDrone ?? Object.keys(o.drones)[0],
    courseKey: o.initialCourse ? INITIAL_COURSE_KEY : (q.get('course') ?? 'obstacles'),
    env: o.initialEnv ?? ENV_CALM(),
    course: o.initialCourse ?? COURSE_PRESETS[q.get('course') ?? 'obstacles']?.() ?? COURSE_PRESETS.obstacles(),
    estimator: 'filter' as 'filter' | 'truth',
    seed: 42,
    speed: 1,
    visualScale: Number(q.get('scale') ?? 3),
    /** Camera mode: free overview, follow (orbit with mouse), chase (behind), top-down follow. */
    cam: (q.get('cam') ?? 'free') as CameraMode,
    followDist: Number(q.get('camDist') ?? CAMERA_FOLLOW.defaultDistance),
    /** Replay time of a recorded scenario (null = not replaying). */
    replayT: null as number | null,
    manual: false,
    running: false,
  };

  // ---------- layout ----------
  const side = el('div', { class: 'side' });
  const vpBox = el('div', { class: 'viewport' });
  const overlay = el('div', { class: 'overlay' });
  const overlayR = el('div', { class: 'overlay right' });
  vpBox.append(overlay, overlayR);
  const chartA = el('div');
  const chartB = el('div');
  const bottom = el('div', { class: 'bottom' }, [chartA, chartB]);
  const main = el('div', { class: 'main-col' }, [vpBox, bottom]);
  root.append(el('div', { class: 'layout' }, [side, main]));
  const vp = createViewport(vpBox);

  // ---------- scene ----------
  let courseGroup = new THREE.Group();
  let pathLine: THREE.Line | null = null;
  let rawPathLine: THREE.Line | null = null;
  const trail = createTrail(0x3987e5);
  vp.scene.add(trail.line);
  const spMarker = new THREE.Mesh(new THREE.SphereGeometry(0.015, 12, 12), new THREE.MeshBasicMaterial({ color: 0xeda100 }));
  vp.scene.add(spMarker);
  let mesh: DroneMesh | null = null;
  let sim: Simulation | null = null;
  let sampleIdx = 0;
  let error = '';

  const droneParams = (): DroneParams => o.drones[state.droneKey].build();

  const rebuildScene = (): void => {
    vp.scene.remove(courseGroup);
    courseGroup = buildCourseGroup(state.course, state.env);
    vp.scene.add(courseGroup);
  };

  const rebuildDrone = (p: DroneParams): void => {
    if (mesh) vp.scene.remove(mesh.group);
    mesh = o.meshFactory?.(state.droneKey, p) ?? buildDroneMesh(p);
    mesh.group.scale.setScalar(state.visualScale);
    vp.scene.add(mesh.group);
  };

  const reset = (): void => {
    error = '';
    state.running = false;
    state.replayT = null;
    stopReplay();
    trail.clear();
    sampleIdx = 0;
    if (pathLine) vp.scene.remove(pathLine);
    if (rawPathLine) vp.scene.remove(rawPathLine);
    rebuildScene();
    const p = droneParams();
    try {
      sim = createSimulation({ params: p, env: state.env, course: state.course, seed: state.seed, estimator: state.estimator, idealSensors: state.estimator === 'truth' });
      pathLine = polyline(sim.path, 0xeb6834, true);
      rawPathLine = polyline(sim.rawPath, 0x6b6a66);
      vp.scene.add(rawPathLine, pathLine);
    } catch (e) {
      sim = null;
      error = e instanceof Error ? e.message : String(e);
    }
    rebuildDrone(p);
    syncPose();
    renderCharts();
    updateOverlay();
  };

  const syncPose = (): void => {
    if (!sim || !mesh) return;
    const s = sim.state();
    mesh.group.position.set(s.p.x, s.p.y, s.p.z);
    mesh.group.quaternion.set(s.q.x, s.q.y, s.q.z, s.q.w);
    const sp = sim.setpoint();
    spMarker.position.set(sp.x, sp.y, sp.z);
  };

  const pushTrail = (): void => {
    if (!sim) return;
    for (; sampleIdx < sim.samples.length; sampleIdx++) trail.push(sim.samples[sampleIdx].p);
  };

  const renderCharts = (): void => {
    if (!sim || sim.samples.length < 2) {
      chartA.innerHTML = '';
      chartB.innerHTML = '';
      return;
    }
    const S = sim.samples;
    chartA.innerHTML = lineChartSvg({
      title: '高度',
      xLabel: '時間 [s]',
      yLabel: '高度 [m]',
      series: [
        { name: '実高度', points: S.map((s) => [s.t, s.p.z]) },
        { name: '目標', points: S.map((s) => [s.t, s.sp.z]) },
      ],
      width: 560,
      height: 220,
    });
    chartB.innerHTML = lineChartSvg({
      title: '電池電圧（負荷時）',
      xLabel: '時間 [s]',
      yLabel: '電圧 [V]',
      series: [{ name: '電圧', points: S.map((s) => [s.t, s.vbat]) }],
      refLines: [{ y: droneParams().landCellVoltage * droneParams().battery.cells, label: '着陸閾値' }],
      width: 560,
      height: 220,
    });
    (window as Window & { __attachVizHover?: (s: ParentNode) => void }).__attachVizHover?.(bottom);
  };

  const updateOverlay = (): void => {
    if (error) {
      overlay.textContent = `エラー: ${error}`;
      return;
    }
    if (!sim) return;
    const s = sim.state();
    const p = droneParams();
    overlay.textContent = [
      `機体  ${p.name}`,
      `t     ${sim.time().toFixed(2)} s   phase ${sim.phase()}`,
      `位置  ${s.p.x.toFixed(2)} ${s.p.y.toFixed(2)} ${s.p.z.toFixed(2)} m`,
      `速度  ${Math.hypot(s.v.x, s.v.y, s.v.z).toFixed(2)} m/s`,
      `電池  ${s.batteryVoltage.toFixed(2)} V  ${s.batteryCurrent.toFixed(2)} A  残 ${(s.soc * 100).toFixed(0)} %`,
      `PWM   ${(sim.lastControl()?.u ?? []).map((u) => (u * 100).toFixed(0).padStart(3)).join(' ')} %`,
      sim.crashed() ? `*** 墜落: ${sim.events.find((e) => e.kind === 'crash')?.detail ?? ''}` : '',
    ].join('\n');
    overlayR.textContent = sim.events.slice(-8).map((e) => `${e.t.toFixed(1).padStart(6)}s ${e.kind} ${e.detail}`).join('\n');
  };

  // ---------- manual input ----------
  const keys = new Set<string>();
  const onKey = (e: KeyboardEvent, down: boolean): void => {
    if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return;
    if (down) keys.add(e.key.toLowerCase());
    else keys.delete(e.key.toLowerCase());
  };
  const kd = (e: KeyboardEvent): void => onKey(e, true);
  const ku = (e: KeyboardEvent): void => onKey(e, false);
  window.addEventListener('keydown', kd);
  window.addEventListener('keyup', ku);
  const manualInput = () => {
    const tilt = 0.35;
    const ax = (a: string, b: string): number => (keys.has(a) ? 1 : 0) - (keys.has(b) ? 1 : 0);
    return {
      // FLU: +pitch tilts nose down -> forward; +roll tilts right side down -> moves -y (right)
      pitch: tilt * ax('w', 's'),
      roll: tilt * ax('d', 'a'),
      yawRate: 1.5 * ax('q', 'e'),
      climbRate: 0.8 * ax('r', 'f'),
    };
  };

  // ---------- controls ----------
  const droneOptions = Object.entries(o.drones).map(([k, d]) => ({ value: k, label: d.label }));
  const courseText = el('textarea');
  const refreshCourseText = (): void => {
    courseText.value = JSON.stringify(state.course, null, 1);
  };
  const runBtn = button('▶ 実行', () => {
    if (!sim) return;
    state.running = !state.running;
    if (state.running) stopReplay();
    runBtn.textContent = state.running ? '⏸ 一時停止' : '▶ 実行';
  }, 'btn primary');
  // ---------- follow camera ----------
  const lastP = new THREE.Vector3();
  const chaseDir = new THREE.Vector3(1, 0, 0);
  const setCamMode = (mode: CameraMode): void => {
    state.cam = mode;
    vp.controls.enabled = mode === 'free' || mode === 'orbit';
    if (mode === 'free' || !mesh) return;
    const p = mesh.group.position;
    const d = state.followDist;
    // close-range clip planes: the vehicle is a few tenths of a metre across
    vp.camera.near = 0.01;
    vp.camera.far = Math.max(2000, 5 * Math.max(state.env.boundsMax.x - state.env.boundsMin.x, state.env.boundsMax.y - state.env.boundsMin.y));
    vp.camera.updateProjectionMatrix();
    spMarker.visible = true;
    lastP.copy(p);
    if (mode === 'orbit') vp.lookAt(p.clone(), new THREE.Vector3(p.x - 0.6 * d, p.y - 0.8 * d, p.z + 0.5 * d));
  };
  const updateFollowCamera = (dt: number): void => {
    if (state.cam === 'free' || !mesh) return;
    const p = mesh.group.position;
    const d = state.followDist;
    const moved = new THREE.Vector3().subVectors(p, lastP);
    if (state.cam === 'orbit') {
      // keep the user's orbit offset, translate with the vehicle
      vp.camera.position.add(moved);
      vp.controls.target.copy(p);
    } else {
      const speed = dt > 0 ? Math.hypot(moved.x, moved.y) / dt : 0;
      if (speed > CAMERA_FOLLOW.minSpeedForHeading) chaseDir.lerp(new THREE.Vector3(moved.x, moved.y, 0).normalize(), Math.min(1, dt * CAMERA_FOLLOW.smoothing)).normalize();
      
      const want = state.cam === 'chase'
        ? new THREE.Vector3(p.x - chaseDir.x * d, p.y - chaseDir.y * d, p.z + CAMERA_FOLLOW.chaseHeight * d)
        : new THREE.Vector3(p.x, p.y - 0.01, p.z + CAMERA_FOLLOW.topHeight * d);
      vp.camera.position.lerp(want, Math.min(1, dt * CAMERA_FOLLOW.smoothing));
      vp.controls.target.copy(p);
      vp.camera.lookAt(p);
    }
    lastP.copy(p);
  };

  // ---------- replay of a recorded (scenario) flight ----------
  let replaying = false;
  const stopReplay = (): void => {
    replaying = false;
    replayBtn.textContent = '▶ 記録を再生';
  };
  const replayBtn = button('▶ 記録を再生', () => {
    if (!sim || sim.samples.length === 0) return;
    if (replaying) {
      stopReplay();
      return;
    }
    state.running = false;
    runBtn.textContent = '▶ 実行';
    const T = sim.samples[sim.samples.length - 1].t;
    if (state.replayT === null || state.replayT >= T) state.replayT = 0;
    replaying = true;
    replayBtn.textContent = '⏸ 再生を停止';
  });
  const replaySlider = el('input', { type: 'range', min: '0', max: '1000', value: '1000', title: '再生位置（記録済みの飛行）' });
  replaySlider.style.width = '100%';
  replaySlider.addEventListener('input', () => {
    if (!sim || sim.samples.length === 0) return;
    stopReplay();
    state.replayT = (Number(replaySlider.value) / 1000) * sim.samples[sim.samples.length - 1].t;
    poseAt(state.replayT);
  });

  side.append(
    heading('機体'),
    selectField('プリセット', droneOptions, state.droneKey, (v) => { state.droneKey = v; reset(); }),
    numberField('表示倍率（見やすさ用）', state.visualScale, 1, (v) => { state.visualScale = Math.max(1, v); if (mesh) mesh.group.scale.setScalar(state.visualScale); }),
    heading('環境'),
    numberField('重力 [m/s²]', state.env.gravity, 0.01, (v) => { state.env = { ...state.env, gravity: v }; reset(); }),
    numberField('空気密度 [kg/m³]', state.env.airDensity, 0.01, (v) => { state.env = { ...state.env, airDensity: v }; reset(); }),
    numberField('平均風 東向き [m/s]', state.env.wind.mean.x, 0.5, (v) => { state.env = { ...state.env, wind: { ...state.env.wind, mean: v3(v, state.env.wind.mean.y, 0) } }; reset(); }),
    numberField('平均風 北向き [m/s]', state.env.wind.mean.y, 0.5, (v) => { state.env = { ...state.env, wind: { ...state.env.wind, mean: v3(state.env.wind.mean.x, v, 0) } }; reset(); }),
    numberField('突風 σ [m/s]', state.env.wind.gustStd, 0.1, (v) => { state.env = { ...state.env, wind: { ...state.env.wind, gustStd: Math.max(0, v) } }; reset(); }),
    heading('コース'),
    selectField('プリセット', [
      ...(o.initialCourse ? [{ value: INITIAL_COURSE_KEY, label: o.initialCourse.name }] : []),
      ...Object.keys(COURSE_PRESETS).map((k) => ({ value: k, label: COURSE_PRESETS[k]().name })),
    ], state.courseKey, (v) => {
      state.courseKey = v;
      state.course = v === INITIAL_COURSE_KEY && o.initialCourse ? JSON.parse(JSON.stringify(o.initialCourse)) as CourseSpec : COURSE_PRESETS[v]();
      refreshCourseText();
      reset();
    }),
    el('div', { class: 'hint', text: 'コース定義（JSON）を編集して「適用」。obstacles は box（center,size）、cylinder（base,radius,height）、prism（footprint,zMin,zMax：建物）。' }),
    courseText,
    el('div', { class: 'btn-row' }, [
      button('適用', () => {
        try {
          state.course = parseCourse(courseText.value, state.course);
          reset();
        } catch (e) {
          error = e instanceof Error ? e.message : String(e);
          updateOverlay();
        }
      }),
      button('柱を追加', () => {
        const id = `pillar-${state.course.obstacles.length + 1}`;
        state.course = { ...state.course, obstacles: [...state.course.obstacles, { kind: 'cylinder', id, base: v3(Math.round(Math.random() * 6 - 3), Math.round(Math.random() * 4 - 2), 0), radius: 0.25, height: 3 }] };
        refreshCourseText();
        reset();
      }),
    ]),
    heading('推定・実行'),
    selectField('状態推定', [{ value: 'filter', label: 'センサ＋推定器' }, { value: 'truth', label: '真値（理想）' }], state.estimator, (v) => { state.estimator = v === 'truth' ? 'truth' : 'filter'; reset(); }),
    numberField('乱数シード', state.seed, 1, (v) => { state.seed = Math.round(v); reset(); }),
    selectField('再生速度', ['0.25', '0.5', '1', '2', '5'].map((x) => ({ value: x, label: `×${x}` })), '1', (v) => { state.speed = parseFloat(v); }),
    selectField('カメラ', [
      { value: 'free', label: '全体（自由に操作）' },
      { value: 'orbit', label: '機体を追従（マウスで回転・ズーム可）' },
      { value: 'chase', label: '機体の後方から追従' },
      { value: 'top', label: '機体の真上から追従' },
    ], state.cam, (v) => setCamMode(v as CameraMode)),
    numberField('追従距離 [m]', state.followDist, 0.5, (v) => { state.followDist = Math.max(0.3, v); setCamMode(state.cam); }),
    el('div', { class: 'btn-row' }, [replayBtn]),
    replaySlider,
    el('div', { class: 'btn-row' }, [runBtn, button('⟲ リセット', () => { reset(); runBtn.textContent = '▶ 実行'; })]),
    heading('手動飛行'),
    checkField('手動モード（高度維持＋角度）', state.manual, (v) => {
      state.manual = v;
      if (!v) sim?.setManual(null);
    }),
    el('div', { class: 'hint', html: '<span class="kbd">W</span>/<span class="kbd">S</span> 前後　<span class="kbd">A</span>/<span class="kbd">D</span> 左右　<span class="kbd">Q</span>/<span class="kbd">E</span> ヨー　<span class="kbd">R</span>/<span class="kbd">F</span> 上昇/下降' }),
    heading('ゴール判定（段階1）'),
  );
  const scenarioBox = el('div');
  side.append(scenarioBox);
  for (const def of [...SCENARIOS, ...(o.scenarios ?? [])]) {
    const b = button(`${def.id} ${def.title}`, () => showScenario(def.id));
    scenarioBox.append(el('div', { class: 'btn-row' }, [b]));
  }
  refreshCourseText();

  /** Run a goal scenario to completion and display the full trajectory. */
  const showScenario = (id: string): void => {
    const def = [...SCENARIOS, ...OUTDOOR_SCENARIOS, ...OUTDOOR_C_SCENARIOS, ...(o.scenarios ?? [])].find((d) => d.id === id);
    if (!def) return;
    state.env = def.env();
    state.course = def.course();
    refreshCourseText();
    reset();
    const r = runScenario(def, droneParams(), { seed: state.seed, estimator: state.estimator });
    sim = r.sim;
    if (pathLine) vp.scene.remove(pathLine);
    if (rawPathLine) vp.scene.remove(rawPathLine);
    pathLine = polyline(sim.path, 0xeb6834, true);
    rawPathLine = polyline(sim.rawPath, 0x6b6a66);
    vp.scene.add(rawPathLine, pathLine);
    trail.clear();
    sampleIdx = 0;
    pushTrail();
    syncPose();
    renderCharts();
    updateOverlay();
    overlay.textContent += `\n${r.id} ${r.title}: ${r.pass ? '合格' : '不合格'}\n` + r.criteria.map((c) => `  ${c.pass ? '✓' : '✗'} ${c.label} ${c.value.toFixed(3)} ${c.unit}（基準 ${c.op === 'lt' ? '<' : '≥'} ${c.limit}）`).join('\n');
  };

  // ---------- loop ----------
  let chartTimer = 0;
  vp.onFrame((dt) => {
    if (sim && replaying && state.replayT !== null && sim.samples.length) {
      const T = sim.samples[sim.samples.length - 1].t;
      state.replayT = Math.min(T, state.replayT + dt * state.speed);
      poseAt(state.replayT);
      replaySlider.value = String(Math.round((state.replayT / T) * 1000));
      if (state.replayT >= T) stopReplay();
    }
    if (sim && state.running && !sim.finished()) {
      if (state.manual) sim.setManual(manualInput());
      sim.advance(dt * state.speed);
      pushTrail();
      syncPose();
      chartTimer += dt;
      if (chartTimer > 0.5) {
        chartTimer = 0;
        renderCharts();
      }
      updateOverlay();
    }
    if (sim && mesh) mesh.update(sim.state().rotorSpeed, dt * state.speed);
    updateFollowCamera(dt);
  });

  // ---------- camera presets ----------
  const setCamera = (view: string): void => {
    const cx = (state.env.boundsMin.x + state.env.boundsMax.x) / 2;
    const cy = (state.env.boundsMin.y + state.env.boundsMax.y) / 2;
    const atT = q.get('at');
    if (view === 'follow' && sim) {
      const S = sim.samples;
      const t = atT ? parseFloat(atT) : S.length ? S[S.length - 1].t : 0;
      const smp = S.find((x) => x.t >= t) ?? S[S.length - 1];
      const p = smp ? smp.p : sim.state().p;
      spMarker.visible = false;
      vp.camera.near = 0.005;
      vp.camera.far = Math.max(500, 5 * Math.max(state.env.boundsMax.x - state.env.boundsMin.x, state.env.boundsMax.y - state.env.boundsMin.y));
      vp.camera.updateProjectionMatrix();
      vp.lookAt(new THREE.Vector3(p.x, p.y, p.z), new THREE.Vector3(p.x - 0.28, p.y - 0.36, p.z + 0.2));
      return;
    }
    // camera distance follows the flying field size (indoor room = 12 m -> factor 1)
    const k = Math.max(1, Math.max(state.env.boundsMax.x - state.env.boundsMin.x, state.env.boundsMax.y - state.env.boundsMin.y) / 12);
    // clip planes follow the field size too (city blocks are ~1 km across)
    vp.camera.near = Math.min(0.05 * k, 1);
    vp.camera.far = Math.max(500, 60 * k);
    vp.camera.updateProjectionMatrix();
    if (view === 'top') vp.lookAt(new THREE.Vector3(cx, cy, 0), new THREE.Vector3(cx, cy - 0.01, 14 * k));
    else if (view === 'close') vp.lookAt(new THREE.Vector3(0, 0, 1), new THREE.Vector3(-1.6, -2.2, 1.8));
    else vp.lookAt(new THREE.Vector3(cx, cy, 0.8), new THREE.Vector3(cx - 7 * k, cy - 9 * k, 7 * k));
  };

  reset();
  setCamera(q.get('view') ?? 'iso');
  if (state.cam !== 'free') setCamMode(state.cam);
  /** Pose the vehicle at a logged time (for screenshots of the flight). */
  const poseAt = (t: number): void => {
    if (!sim || !mesh) return;
    const S = sim.samples;
    const smp = S.find((x) => x.t >= t) ?? S[S.length - 1];
    if (!smp) return;
    mesh.group.position.set(smp.p.x, smp.p.y, smp.p.z);
    const qq = new THREE.Quaternion().setFromEuler(new THREE.Euler(smp.roll, smp.pitch, smp.yaw, 'ZYX'));
    mesh.group.quaternion.copy(qq);
    spMarker.position.set(smp.sp.x, smp.sp.y, smp.sp.z);
    const p = droneParams();
    overlay.textContent = [
      `機体  ${p.name}`,
      `t     ${smp.t.toFixed(2)} s（記録の再生） phase ${smp.phase}`,
      `位置  ${smp.p.x.toFixed(2)} ${smp.p.y.toFixed(2)} ${smp.p.z.toFixed(2)} m`,
      `速度  ${Math.hypot(smp.v.x, smp.v.y, smp.v.z).toFixed(2)} m/s   傾き ${((Math.hypot(smp.roll, smp.pitch) * 180) / Math.PI).toFixed(1)}°`,
      `電池  ${smp.vbat.toFixed(2)} V  ${smp.current.toFixed(2)} A`,
      `PWM   ${smp.u.map((u) => (u * 100).toFixed(0).padStart(3)).join(' ')} %`,
    ].join('\n');
    // give the props a visible angle (still image)
    mesh.update(new Array<number>(8).fill(40), 0.02);
  };
  const scenarioId = q.get('scenario');
  if (scenarioId) {
    showScenario(scenarioId);
    const at = q.get('at');
    if (at) poseAt(parseFloat(at));
    setCamera(q.get('view') ?? 'iso');
    if (state.cam !== 'free') setCamMode(state.cam);
    markReady();
  } else if (q.get('autorun')) {
    (sim as Simulation | null)?.runToEnd(120);
    pushTrail();
    syncPose();
    renderCharts();
    updateOverlay();
    markReady();
  } else {
    markReady();
  }

  return () => {
    window.removeEventListener('keydown', kd);
    window.removeEventListener('keyup', ku);
    vp.dispose();
    style.remove();
  };
};
