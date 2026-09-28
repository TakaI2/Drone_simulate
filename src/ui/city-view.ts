import type { CourseSpec, DroneParams, EnvironmentSpec } from '../core/types';
import { cityScenario } from '../integration/city';
import type { ScenarioDef } from '../sim/scenarios';
import { mountSimView } from './sim-view';
import { el } from './widgets';

/** Scene exported by `npm run city` (buildings as prism obstacles, environments, scenario list). */
interface CityScene {
  name: string;
  attribution: string[];
  scenarios: Array<{ id: string; title: string; description: string; course: CourseSpec; env: EnvironmentSpec }>;
}

/** City tab: Minatomirai buildings (PLATEAU / OSM) with the variant C outdoor vehicle. */
export const mount = (root: HTMLElement, query: URLSearchParams): (() => void) => {
  let dispose: (() => void) | null = null;
  let cancelled = false;
  const note = el('div', { class: 'doc', text: '都市モデルを読み込み中…' });
  root.append(note);
  Promise.all([fetch('/out/city/scene.json'), fetch('/out/variantC/drone_params.json')]).then(async ([s, p]) => {
    if (cancelled) return;
    note.remove();
    if (!s.ok || !p.ok) {
      root.append(el('div', { class: 'doc', html: '<p>都市データがありません。<code>npm run variantC</code> と <code>npm run city</code> を実行してください。</p>' }));
      document.body.dataset.ready = '1';
      return;
    }
    const scene = (await s.json()) as CityScene;
    const params = (await p.json()) as DroneParams;
    const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
    const scenarios: ScenarioDef[] = scene.scenarios.map((c) => cityScenario(c.id, c.title, c.description, () => clone(c.course), () => clone(c.env)));
    const first = scene.scenarios.find((c) => c.id === query.get('scenario')) ?? scene.scenarios[0];
    dispose = mountSimView(root, {
      query,
      drones: { designed: { label: '★ 版 C 屋外機', build: () => params } },
      initialDrone: 'designed',
      scenarios,
      initialCourse: clone(first.course),
      initialEnv: clone(first.env),
    });
    root.append(el('div', { class: 'hint', text: scene.attribution.join(' / ') }));
  });
  return () => {
    cancelled = true;
    dispose?.();
  };
};
