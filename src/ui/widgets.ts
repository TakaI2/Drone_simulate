/** Tiny DOM helpers (no framework). */

export const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: Array<HTMLElement | string> = [],
): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k === 'html') e.innerHTML = v;
    else e.setAttribute(k, v);
  }
  for (const c of children) e.append(c);
  return e;
};

export const heading = (text: string): HTMLElement => el('h3', { text });

export const numberField = (label: string, value: number, step: number, onChange: (v: number) => void): HTMLLabelElement => {
  const input = el('input', { type: 'number', step: String(step), value: String(value) });
  input.addEventListener('change', () => {
    const v = parseFloat(input.value);
    if (Number.isFinite(v)) onChange(v);
  });
  return el('label', {}, [label, input]);
};

export const selectField = (
  label: string,
  options: Array<{ value: string; label: string }>,
  value: string,
  onChange: (v: string) => void,
): HTMLLabelElement => {
  const s = el('select');
  for (const o of options) {
    const opt = el('option', { value: o.value, text: o.label });
    if (o.value === value) opt.selected = true;
    s.append(opt);
  }
  s.addEventListener('change', () => onChange(s.value));
  return el('label', {}, [label, s]);
};

export const checkField = (label: string, value: boolean, onChange: (v: boolean) => void): HTMLLabelElement => {
  const c = el('input', { type: 'checkbox' });
  c.checked = value;
  c.addEventListener('change', () => onChange(c.checked));
  return el('label', {}, [label, c]);
};

export const button = (text: string, onClick: () => void, cls = 'btn'): HTMLButtonElement => {
  const b = el('button', { class: cls, text });
  b.addEventListener('click', onClick);
  return b;
};

/** Mark page as ready for automated screenshots. */
export const markReady = (): void => {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    document.body.dataset.ready = '1';
  }));
};
