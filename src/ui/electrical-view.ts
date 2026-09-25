import { BATTERIES, MOTORS, PROPS } from '../core/propulsion-catalog';
import { renderSchematicSvg } from '../electrical/schematic';
import { runStage2 } from '../integration/stage2';
import type { Stage2Options } from '../integration/stage2';
import { CHART_CSS } from '../report/chart';
import {
  bomTableHtml, calcTableHtml, gpioTableHtml, iterationsHtml, massTableHtml, searchTableHtml, sizingChecksHtml, sizingSummaryHtml, throttleChartsHtml,
} from '../report/stage2-html';
import { el, heading, markReady, selectField } from './widgets';

const DOC_CSS = `
.doc .pill{display:inline-block;padding:0 8px;border-radius:10px;font-size:11px;font-weight:600;border:1px solid currentColor;white-space:nowrap}
.doc .pill.pass{color:#0ca30c}.doc .pill.fail{color:#d03b3b}
.doc .grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.doc a{color:#6da7ec}
.doc .note{color:#c3c2b7;font-size:12px}
`;

export const mount = (root: HTMLElement, query: URLSearchParams): (() => void) => {
  const style = el('style', { text: CHART_CSS + DOC_CSS });
  document.head.append(style);
  const state: { rotorCount: number; mode: 'auto' | 'manual'; motorId: string; propId: string; batteryId: string } = {
    rotorCount: Number(query.get('rotors') ?? 4),
    mode: 'auto',
    motorId: 'coreless-0820',
    propId: 'prop-65',
    batteryId: 'lipo-1s-600',
  };
  const side = el('div', { class: 'side' });
  const doc = el('div', { class: 'doc' });
  root.append(el('div', { class: 'layout' }, [side, doc]));

  const render = (): void => {
    const opts: Stage2Options = { rotorCount: state.rotorCount };
    if (state.mode === 'manual') opts.override = { motorId: state.motorId, propId: state.propId, batteryId: state.batteryId };
    try {
      const r = runStage2(opts);
      doc.innerHTML = `
<h2>推奨構成（サイジング結果）</h2>${sizingSummaryHtml(r.sizing)}${sizingChecksHtml(r.sizing)}
<h2>質量内訳</h2>${massTableHtml(r.sizing)}
<h2>推進系の特性</h2>${throttleChartsHtml(r.sizing)}
<h2>組合せ探索</h2>${searchTableHtml(r, 20)}
<h2>質量の収束反復</h2>${iterationsHtml(r)}
<h2>回路図</h2><div class="svgbox">${renderSchematicSvg(r.circuit)}</div>
<h2>電気計算と検証</h2>${calcTableHtml(r)}
<h2>GPIO 割当て</h2>${gpioTableHtml(r)}
<h2>部品表（BOM）</h2>${bomTableHtml(r)}`;
      const svg = doc.querySelector('.svgbox svg');
      if (svg) {
        svg.removeAttribute('width');
        svg.removeAttribute('height');
        (svg as SVGElement).style.width = '100%';
      }
      (window as Window & { __attachVizHover?: (s: ParentNode) => void }).__attachVizHover?.(doc);
    } catch (e) {
      doc.innerHTML = `<p>エラー: ${e instanceof Error ? e.message : String(e)}</p>`;
    }
  };

  side.append(
    heading('機体構成'),
    selectField('ロータ数', ['4', '6', '8'].map((v) => ({ value: v, label: `${v} ロータ` })), String(state.rotorCount), (v) => { state.rotorCount = Number(v); render(); }),
    selectField('推進系の決定', [{ value: 'auto', label: '自動探索（推奨）' }, { value: 'manual', label: '手動指定' }], state.mode, (v) => { state.mode = v === 'manual' ? 'manual' : 'auto'; render(); }),
    heading('手動指定時の部品'),
    selectField('モータ', MOTORS.map((m) => ({ value: m.id, label: m.id })), state.motorId, (v) => { state.motorId = v; render(); }),
    selectField('プロペラ', PROPS.map((p) => ({ value: p.id, label: p.id })), state.propId, (v) => { state.propId = v; render(); }),
    selectField('電池', BATTERIES.map((b) => ({ value: b.id, label: b.id })), state.batteryId, (v) => { state.batteryId = v; render(); }),
    el('p', { class: 'hint', text: '自動探索では、汎用品（多メーカー品）を優先し、その中で飛行時間が最長の組合せを選びます。電子回路の質量は回路から再計算し、収束するまで反復します。' }),
  );
  render();
  markReady();
  return () => style.remove();
};
