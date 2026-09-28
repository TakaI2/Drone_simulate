import './style.css';
import { DRONE_PRESETS } from '../core/presets';
import { CHART_HOVER_JS } from '../report/chart';
import { mountSimView } from './sim-view';
import { el } from './widgets';

// chart hover layer (shared with the static reports)
document.head.append(el('script', { text: CHART_HOVER_JS }));

type Mount = (root: HTMLElement, query: URLSearchParams) => () => void;

const PRESET_LABELS: Record<string, string> = {
  'micro-quad': 'Class A 参照機（クアッド）',
  'micro-hexa': 'マイクロ・ヘキサ',
  '250-quad': 'Class B 250級',
};

const presetDrones = Object.fromEntries(
  Object.entries(DRONE_PRESETS).map(([k, build]) => [k, { label: PRESET_LABELS[k] ?? k, build }]),
);

const lazy = (loader: () => Promise<{ mount: Mount }>): Mount => (root, query) => {
  let dispose: (() => void) | null = null;
  let cancelled = false;
  loader().then((m) => {
    if (!cancelled) dispose = m.mount(root, query);
  });
  return () => {
    cancelled = true;
    dispose?.();
  };
};

const TABS: Array<{ id: string; label: string; mount: Mount }> = [
  { id: 'sim', label: '1 シミュレーション', mount: (root, query) => mountSimView(root, { query, drones: presetDrones }) },
  { id: 'electrical', label: '2 推進・電気', mount: lazy(() => import('./electrical-view')) },
  { id: 'pcb', label: '3 部品・基板', mount: lazy(() => import('./pcb-view')) },
  { id: 'airframe', label: '4 機体', mount: lazy(() => import('./airframe-view')) },
  { id: 'assembly', label: '5 統合', mount: lazy(() => import('./assembly-view')) },
  { id: 'city', label: '6 都市（横浜）', mount: lazy(() => import('./city-view')) },
];

const app = document.getElementById('app') as HTMLElement;
if (new URLSearchParams(location.search).get('capture')) document.body.classList.add('capture');
const nav = document.getElementById('tabs') as HTMLElement;
let dispose: (() => void) | null = null;

const show = (id: string, push = true): void => {
  const tab = TABS.find((t) => t.id === id) ?? TABS[0];
  dispose?.();
  app.innerHTML = '';
  delete document.body.dataset.ready;
  const query = new URLSearchParams(location.search);
  if (push) {
    query.set('tab', tab.id);
    for (const k of ['scenario', 'autorun', 'view']) query.delete(k);
    history.replaceState(null, '', `?${query.toString()}`);
  }
  nav.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab.id));
  dispose = tab.mount(app, query);
};

const variantSel = el('select', { title: '設計の版' });
for (const [v, label] of [['A', '版 A（元設計）'], ['B', '版 B（センサ子基板＋GNSS 端子）'], ['C', '版 C（屋外機：ブラシレス＋GNSS）']]) {
  const o = el('option', { value: v, text: label });
  if ((new URLSearchParams(location.search).get('variant') ?? 'A') === v) o.selected = true;
  variantSel.append(o);
}
variantSel.addEventListener('change', () => {
  const q = new URLSearchParams(location.search);
  if (variantSel.value !== 'A') q.set('variant', variantSel.value);
  else q.delete('variant');
  history.replaceState(null, '', `?${q.toString()}`);
  show(q.get('tab') ?? 'sim', false);
});
variantSel.style.cssText = 'margin-left:auto;background:#232321;color:#fff;border:1px solid #383835;border-radius:4px;padding:3px 6px;font-size:12px';

for (const t of TABS) {
  const b = el('button', { text: t.label });
  b.dataset.tab = t.id;
  b.addEventListener('click', () => show(t.id));
  nav.append(b);
}
document.getElementById('app-header')?.append(variantSel);
show(new URLSearchParams(location.search).get('tab') ?? 'sim', false);
