import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { buildAssembly } from '../airframe/assembly3d';
import type { AssemblyInfo } from '../airframe/assembly3d';
import type { Check } from '../airframe/design';
import type { PcbDesign } from '../pcb/types';
import type { AirframeLike } from '../integration/stage5';
import { statusPill, table } from '../report/html';
import { createViewport } from './viewport';
import { checkField, el, heading, markReady, selectField } from './widgets';

export interface AirframeJson extends AssemblyInfo, AirframeLike {
  massG: number;
  cg: [number, number, number];
  frameMassG: number;
  items: Array<{ name: string; massG: number }>;
  checks: Check[];
}

/** Output locations of the design variants (A = original, B = sensor sub-board + GNSS port, C = outdoor vehicle). */
export const variantPaths = (variant: string | null): { frame: string; airframe: string; pcb: string; flowPcb: string | null } =>
  variant === 'B'
    ? { frame: '/out/variantB/frame.stl', airframe: '/out/variantB/airframe.json', pcb: '/out/variantB/pcb.json', flowPcb: '/out/variantB/flow_pcb.json' }
    : variant === 'C'
      ? { frame: '/out/variantC/frame.stl', airframe: '/out/variantC/airframe.json', pcb: '/out/variantC/pcb.json', flowPcb: null }
      : { frame: '/out/stage4/frame.stl', airframe: '/out/stage4/airframe.json', pcb: '/out/stage3/pcb.json', flowPcb: null };

export const loadAirframeAssets = async (variant: string | null = null): Promise<{ geo: THREE.BufferGeometry; info: AirframeJson; pcb: PcbDesign | null } | null> => {
  const paths = variantPaths(variant);
  const [stl, js, pcb, flow] = await Promise.all([fetch(paths.frame), fetch(paths.airframe), fetch(paths.pcb), paths.flowPcb ? fetch(paths.flowPcb) : Promise.resolve(null)]);
  if (!stl.ok || !js.ok) return null;
  const geo = new STLLoader().parse(await stl.arrayBuffer());
  const info = (await js.json()) as AirframeJson;
  const pcbJson = pcb.ok ? ((await pcb.json()) as { design: PcbDesign }) : null;
  if (flow && flow.ok) {
    const fj = (await flow.json()) as { design: PcbDesign; lens: { ref: string; diameter: number; height: number } };
    info.flowBoard = fj.design;
    info.flowLens = fj.lens;
  }
  return { geo, info, pcb: pcbJson?.design ?? null };
};

export const setAssemblyCamera = (cam: (t: THREE.Vector3, p: THREE.Vector3) => void, view: string, zc: number): void => {
  const t = new THREE.Vector3(0, 0, zc);
  if (view === 'top') cam(t, new THREE.Vector3(0, -0.01, 190));
  else if (view === 'side') cam(t, new THREE.Vector3(0, -170, zc + 5));
  else if (view === 'bottom') cam(t, new THREE.Vector3(-60, -90, -110));
  else if (view === 'front') cam(t, new THREE.Vector3(170, 0, zc + 10));
  else cam(t, new THREE.Vector3(-95, -120, 95));
};

export const mount = (root: HTMLElement, query: URLSearchParams): (() => void) => {
  const side = el('div', { class: 'side' });
  const box = el('div', { class: 'viewport' });
  const mainCol = el('div', { class: 'main-col' }, [box]);
  root.append(el('div', { class: 'layout' }, [side, mainCol]));
  const vp = createViewport(box, { background: 0x1d2024, grid: { size: 400, divisions: 40 } });
  const state = { view: query.get('view') ?? 'iso', disks: query.get('disks') !== '0', cg: query.get('cg') !== '0', frameOnly: query.get('frameOnly') === '1' };
  let group: THREE.Group | null = null;
  let props: THREE.Object3D[] = [];
  let assets: Awaited<ReturnType<typeof loadAirframeAssets>> = null;
  const info = el('div');

  const rebuild = (): void => {
    if (!assets) return;
    if (group) vp.scene.remove(group);
    const a = buildAssembly(assets.geo.clone(), state.frameOnly ? null : assets.pcb, assets.info, { showPropDisks: state.disks, showCg: state.cg });
    group = a.group;
    props = a.props;
    if (state.frameOnly) group.children = group.children.filter((c) => c.name === 'frame');
    vp.scene.add(group);
  };
  vp.onFrame((dt) => props.forEach((p) => (p.rotation.z += (p.userData.spin as number) * 8 * dt)));

  side.append(
    heading('表示'),
    selectField('視点', ['iso', 'top', 'side', 'front', 'bottom'].map((v) => ({ value: v, label: { iso: '斜め', top: '上面', side: '側面', front: '正面', bottom: '下面' }[v] ?? v })), state.view, (v) => {
      state.view = v;
      setAssemblyCamera((t, p) => vp.lookAt(t, p), v, assets?.info.cg[2] ?? 5);
    }),
    checkField('プロペラ回転面', state.disks, (v) => { state.disks = v; rebuild(); }),
    checkField('重心（赤）と推力軸', state.cg, (v) => { state.cg = v; rebuild(); }),
    checkField('フレームのみ（造形物）', state.frameOnly, (v) => { state.frameOnly = v; rebuild(); }),
    heading('ダウンロード'),
    el('div', {}, [el('a', { href: variantPaths(query.get('variant')).frame, text: 'フレーム STL（3D プリント用）', download: '' })]),
    heading('設計結果'),
    info,
  );

  loadAirframeAssets(query.get('variant'))
    .then((a) => {
      assets = a;
      if (!a) {
        info.innerHTML = '<p class="hint">機体データがありません。npm run stage4 を実行してください。</p>';
      } else {
        info.innerHTML = `<div class="doc" style="padding:0">${table(['項目', '値'], [['全備重量', `${a.info.massG.toFixed(1)} g`], ['フレーム', `${a.info.frameMassG.toFixed(1)} g`], ['重心', a.info.cg.map((v) => v.toFixed(2)).join(', ') + ' mm'], ['電池位置', `x ${a.info.battery.x.toFixed(1)} / y ${a.info.battery.y.toFixed(1)} mm`]])}${table(['検証', '判定'], a.info.checks.map((c) => [`${c.label}: ${c.value.toFixed(2)} ${c.unit}`, statusPill(c.pass)]))}</div>`;
        rebuild();
        setAssemblyCamera((t, p) => vp.lookAt(t, p), state.view, a.info.cg[2]);
      }
      markReady();
    })
    .catch(() => markReady());
  return () => vp.dispose();
};
