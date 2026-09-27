import * as THREE from 'three';
import { buildBreadboard, renderBreadboardSvg } from '../electrical/breadboard';
import { packageMesh } from '../parts3d/models';
import { PACKAGES, getPackage } from '../parts3d/packages';
import { buildBoard3d } from '../pcb/board3d';
import { renderPcbSvg } from '../pcb/svg';
import type { PcbDesign } from '../pcb/types';
import { createViewport } from './viewport';
import type { Viewport } from './viewport';
import { checkField, el, heading, markReady, selectField } from './widgets';

interface PcbJson {
  design: PcbDesign;
  stats: { trackLengthMm: number; viaCount: Record<string, number> };
  drc: { counts: Record<string, number> };
}

const DOWNLOADS_B: Array<[string, string]> = [
  ['メイン基板 B Gerber（ZIP）', '/out/variantB/main_gerber.zip'],
  ['センサ子基板 Gerber（ZIP）', '/out/variantB/flow_gerber.zip'],
  ['メイン基板 B KiCad', '/out/variantB/main.kicad_pcb'],
  ['センサ子基板 KiCad', '/out/variantB/flow.kicad_pcb'],
  ['センサ子基板 回路図', '/out/variantB/flow_schematic.svg'],
];

const DOWNLOADS_C: Array<[string, string]> = [
  ['版 C 基板 Gerber（ZIP）', '/out/variantC/fc_gerber.zip'],
  ['版 C 基板 KiCad', '/out/variantC/fc.kicad_pcb'],
  ['版 C 部品実装座標（CPL）', '/out/variantC/fc_cpl.csv'],
  ['版 C 回路図', '/out/variantC/schematic.svg'],
  ['版 C BOM', '/out/variantC/bom.csv'],
];

const DOWNLOADS: Array<[string, string]> = [
  ['Gerber 一式（ZIP）', '/out/stage3/drone_fc_gerber.zip'],
  ['KiCad 基板', '/out/stage3/drone_fc.kicad_pcb'],
  ['部品実装座標（CPL）', '/out/stage3/drone_fc_cpl.csv'],
  ['BOM（JLC 形式）', '/out/stage3/drone_fc_bom_jlc.csv'],
  ['ネットリスト（KiCad）', '/out/stage2/netlist.net'],
  ['3D 部品カタログ', '/out/parts3d/catalog.json'],
];

/** Text sprite for labels in 3D galleries. */
const label = (text: string, size = 2.2): THREE.Sprite => {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 64;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  g.fillStyle = 'rgba(0,0,0,0)';
  g.fillRect(0, 0, 512, 64);
  g.font = '36px system-ui, sans-serif';
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.fillText(text, 256, 44);
  const tex = new THREE.CanvasTexture(c);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  s.scale.set(size * 8, size, 1);
  return s;
};

export const mount = (root: HTMLElement, query: URLSearchParams): (() => void) => {
  const side = el('div', { class: 'side' });
  const mainBox = el('div', { class: 'main-col' });
  root.append(el('div', { class: 'layout' }, [side, mainBox]));
  const isB = query.get('variant') === 'B';
  const isC = query.get('variant') === 'C';
  const state = { view: query.get('view') ?? '2d', F: true, B: true, pour: true, pkg: query.get('pkg') ?? 'ESP32-S3-WROOM-1', board: query.get('board') ?? 'main' };
  const pcbUrl = (): string => (isB ? (state.board === 'flow' ? '/out/variantB/flow_pcb.json' : '/out/variantB/pcb.json') : isC ? '/out/variantC/pcb.json' : '/out/stage3/pcb.json');
  let vp: Viewport | null = null;
  let data: PcbJson | null = null;
  const info = el('div', { class: 'hint' });

  const clear = (): void => {
    vp?.dispose();
    vp = null;
    mainBox.innerHTML = '';
  };

  const render = (): void => {
    clear();
    if (state.view === 'bb') {
      const doc = el('div', { class: 'doc' });
      doc.innerHTML = `<div class="svgbox">${renderBreadboardSvg(buildBreadboard(4))}</div>`;
      mainBox.append(doc);
      return;
    }
    if (state.view === 'lib') {
      const box = el('div', { class: 'viewport' });
      mainBox.append(box);
      vp = createViewport(box, { background: 0x1d2024, grid: null });
      const ids = Object.keys(PACKAGES);
      const cols = 8;
      const pitch = 22;
      ids.forEach((id, i) => {
        const pkg = getPackage(id);
        const m = packageMesh(pkg, { pads: true });
        const size = Math.max(pkg.courtyard.w, pkg.courtyard.h, pkg.height / 2);
        const s = Math.min(3, 7 / Math.max(0.5, size));
        m.scale.setScalar(s);
        const x = (i % cols) * pitch - ((cols - 1) * pitch) / 2;
        const y = -Math.floor(i / cols) * pitch + 3 * pitch;
        m.position.set(x, y, 0);
        const base = new THREE.Mesh(new THREE.BoxGeometry(pitch * 0.85, pitch * 0.85, 0.3), new THREE.MeshStandardMaterial({ color: 0x14532d }));
        base.position.set(x, y, -0.2);
        const lb = label(id, 2.6);
        lb.position.set(x, y - pitch * 0.36, 0.5);
        vp!.scene.add(base, m, lb);
      });
      vp.lookAt(new THREE.Vector3(0, -10, 0), new THREE.Vector3(0, -110, 150));
      return;
    }
    if (!data) {
      mainBox.append(el('div', { class: 'doc', html: '<p>基板データがありません。<code>npm run stage3</code> を実行してください。</p>' }));
      return;
    }
    const d = data.design;
    if (state.view === '2d') {
      const doc = el('div', { class: 'doc' });
      const layers = [...(state.B ? ['B' as const] : []), ...(state.F ? ['F' as const] : [])];
      doc.innerHTML = `<div class="svgbox" style="background:#1a1a19">${renderPcbSvg(d, { layers, showPour: state.pour, scale: 18 })}</div>`;
      const svg = doc.querySelector('svg');
      if (svg) {
        svg.removeAttribute('width');
        svg.removeAttribute('height');
        (svg as SVGElement).style.width = '100%';
        (svg as SVGElement).style.maxHeight = '85vh';
      }
      mainBox.append(doc);
      return;
    }
    const box = el('div', { class: 'viewport' });
    mainBox.append(box);
    vp = createViewport(box, { background: 0x1d2024, grid: null });
    const board = buildBoard3d(d);
    vp.scene.add(board);
    const s = Math.max(d.board.w, d.board.h);
    if (state.view === '3d-bottom') vp.lookAt(new THREE.Vector3(0, 0, 0), new THREE.Vector3(-0.3 * s, -1.1 * s, -1.0 * s));
    else vp.lookAt(new THREE.Vector3(0, 0, 0), new THREE.Vector3(-0.5 * s, -1.05 * s, 1.0 * s));
  };

  side.append(
    heading('表示'),
    selectField('ビュー', [
      { value: '2d', label: '基板 2D（配線）' },
      { value: '3d', label: '実装済み基板 3D（上面）' },
      { value: '3d-bottom', label: '実装済み基板 3D（下面）' },
      { value: 'lib', label: '部品 3D ライブラリ' },
      { value: 'bb', label: 'ブレッドボード配置' },
    ], state.view, (v) => { state.view = v; render(); }),
    ...(isB
      ? [selectField('基板', [{ value: 'main', label: 'メイン基板（GNSS 端子付き）' }, { value: 'flow', label: 'センサ子基板（フロー＋ToF）' }], state.board, (v) => { state.board = v; load(); })]
      : []),
    heading('2D の層'),
    checkField('上面 F.Cu', state.F, (v) => { state.F = v; render(); }),
    checkField('下面 B.Cu', state.B, (v) => { state.B = v; render(); }),
    checkField('GND ベタ', state.pour, (v) => { state.pour = v; render(); }),
    heading('基板情報'),
    info,
    heading('製造データ'),
    ...(isB ? DOWNLOADS_B : isC ? DOWNLOADS_C : DOWNLOADS).map(([t, href]) => el('div', {}, [el('a', { href, text: t, download: '' })])),
    el('p', { class: 'hint', text: '基板は npm run stage3 で自動配置・自動配線されます（配置 → ファンアウト → 2 層 A* → GND ベタ → DRC → Gerber）。' }),
  );

  const load = (): Promise<void> =>
    fetch(pcbUrl())
    .then((r) => (r.ok ? (r.json() as Promise<PcbJson>) : null))
    .then((j) => {
      data = j;
      if (j) {
        const d = j.design;
        info.innerHTML = `${d.board.w}×${d.board.h} mm / t=${d.rules.boardThickness} mm<br>部品 ${d.placements.length} / トラック ${d.tracks.length} / ビア ${d.vias.length}<br>配線長 ${j.stats.trackLengthMm.toFixed(0)} mm<br>DRC: ${Object.entries(j.drc.counts).map(([k, v]) => `${k} ${v}`).join(', ')}`;
      }
      render();
      markReady();
    })
    .catch(() => {
      render();
      markReady();
    });
  void load();
  return () => clear();
};
