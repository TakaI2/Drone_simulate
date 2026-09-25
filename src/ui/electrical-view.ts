import { el } from './widgets';

export const mount = (root: HTMLElement, _query: URLSearchParams): (() => void) => {
  root.append(el('div', { class: 'doc', text: '準備中' }));
  return () => undefined;
};
