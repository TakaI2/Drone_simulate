import * as THREE from 'three';
import { buildAssembly } from '../airframe/assembly3d';
import { DRONE_PRESETS } from '../core/presets';
import type { DroneParams } from '../core/types';
import { runStage2 } from '../integration/stage2';
import { deriveDroneParams } from '../integration/stage5';
import type { MeasuredOverrides } from '../integration/stage5';
import { loadAirframeAssets } from './airframe-view';
import type { DroneMesh } from './drone-mesh';
import { mountSimView } from './sim-view';
import { el } from './widgets';

/** Stage 5: the completed design flies in the simulator as its real 3D model. */
export const mount = (root: HTMLElement, query: URLSearchParams): (() => void) => {
  let dispose: (() => void) | null = null;
  let cancelled = false;
  const note = el('div', { class: 'doc', text: '完成機体を読み込み中…' });
  root.append(note);
  loadAirframeAssets().then((assets) => {
    if (cancelled) return;
    note.remove();
    if (!assets) {
      root.append(el('div', { class: 'doc', html: '<p>機体データがありません。<code>npm run stage3</code> と <code>npm run stage4</code> を実行してください。</p>' }));
      document.body.dataset.ready = '1';
      return;
    }
    const s2 = runStage2({ rotorCount: assets.info.rotors.length });
    const overrides: MeasuredOverrides = {};
    for (const k of ['ct', 'cp', 'motorTimeConstant', 'massG', 'inertiaScale'] as const) {
      const v = query.get(k);
      if (v !== null && Number.isFinite(Number(v))) overrides[k] = Number(v);
    }
    const derived: DroneParams = deriveDroneParams(s2.sizing, assets.info, overrides);
    const meshFactory = (key: string): DroneMesh | null => {
      if (key !== 'designed') return null;
      const a = buildAssembly(assets.geo.clone(), assets.pcb, assets.info, { showPropDisks: false });
      // simulator body origin = CG, units m
      const inner = a.group;
      inner.scale.setScalar(0.001);
      inner.position.set(-assets.info.cg[0] / 1000, -assets.info.cg[1] / 1000, -assets.info.cg[2] / 1000);
      const outer = new THREE.Group();
      outer.add(inner);
      const update = (rotorSpeed: number[], dt: number): void => {
        a.props.forEach((p, i) => {
          p.rotation.z += (p.userData.spin as number) * Math.min(rotorSpeed[i] ?? 0, 60) * dt;
        });
      };
      return { group: outer, update };
    };
    const drones: Record<string, { label: string; build: () => DroneParams }> = {
      designed: { label: '★ 完成機体（段階2〜4 の設計）', build: () => derived },
      ...Object.fromEntries(Object.entries(DRONE_PRESETS).map(([k, b]) => [k, { label: `参照: ${k}`, build: b }])),
    };
    dispose = mountSimView(root, { query, drones, meshFactory, initialDrone: 'designed' });
  });
  return () => {
    cancelled = true;
    dispose?.();
  };
};
