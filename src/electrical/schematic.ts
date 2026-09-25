import { BLOCK_TITLES } from './circuit';
import type { BlockId, Circuit, Component, PinDef } from './circuit';

/**
 * Net-label style schematic renderer (SVG string, DOM-free).
 * Every pin ends in a stub with its net name; power nets get supply flags, GND gets the ground symbol.
 */

const S = {
  stub: 16,
  pinPitch: 12,
  font: 9,
  cellW: 150,
  cellH: 70,
  blockPad: 14,
  blockW: 470,
  gap: 16,
  ink: '#1d1d1b',
  muted: '#6b6a66',
  body: '#fffdf5',
  power: '#b3261e',
  gnd: '#1c5cab',
  label: '#0d366b',
};

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Net terminal drawn at the end of a stub. dir = direction the stub points (outward). */
const netTerminal = (net: string | null, x: number, y: number, dir: 'l' | 'r' | 'u' | 'd'): string => {
  if (net === null) {
    // NC marker
    return `<path d="M${x - 3},${y - 3}L${x + 3},${y + 3}M${x - 3},${y + 3}L${x + 3},${y - 3}" stroke="${S.muted}" stroke-width="1"/>`;
  }
  const horizontal = dir === 'l' || dir === 'r';
  if (horizontal && (net === 'GND' || net === 'VBAT' || net === '3V3')) {
    // side pins: compact colored label (symbols would collide with neighbouring pins)
    const col = net === 'GND' ? S.gnd : S.power;
    const w = net.length * 6 + 8;
    const bx = dir === 'l' ? x - w : x;
    const tx = dir === 'l' ? x - 4 : x + 4;
    return `<rect x="${bx}" y="${y - 6}" width="${w}" height="12" rx="6" fill="#ffffff" stroke="${col}" stroke-width="0.9"/><text x="${tx}" y="${y + 3}" font-size="${S.font}" font-weight="600" text-anchor="${dir === 'l' ? 'end' : 'start'}" fill="${col}">${esc(net)}</text>`;
  }
  if (net === 'GND') {
    const g = (ox: number, oy: number): string =>
      `<path d="M${ox},${oy}v5M${ox - 6},${oy + 5}h12M${ox - 4},${oy + 8}h8M${ox - 2},${oy + 11}h4" stroke="${S.gnd}" stroke-width="1.2" fill="none"/>`;
    return g(x, y);
  }
  if (net === 'VBAT' || net === '3V3') {
    return `<path d="M${x},${y}v-6M${x - 6},${y - 6}h12" stroke="${S.power}" stroke-width="1.4"/><text x="${x}" y="${y - 9}" font-size="${S.font}" text-anchor="middle" fill="${S.power}" font-weight="600">${esc(net)}</text>`;
  }
  const w = net.length * 5.6 + 8;
  const anchor = dir === 'l' ? 'end' : dir === 'r' ? 'start' : 'middle';
  const tx = dir === 'l' ? x - 5 : dir === 'r' ? x + 5 : x;
  const ty = dir === 'u' ? y - 5 : dir === 'd' ? y + 11 : y + 3;
  const bx = dir === 'l' ? x - w : dir === 'r' ? x : x - w / 2;
  const by = dir === 'u' ? y - 14 : dir === 'd' ? y + 2 : y - 6;
  return `<rect x="${bx}" y="${by}" width="${w}" height="12" rx="2" fill="#eef4fc" stroke="${S.label}" stroke-width="0.6"/><text x="${tx}" y="${ty}" font-size="${S.font}" text-anchor="${anchor}" fill="${S.label}">${esc(net)}</text>`;
};

const line = (x1: number, y1: number, x2: number, y2: number): string =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${S.ink}" stroke-width="1.2"/>`;

const refText = (c: Component, x: number, y: number, anchor = 'middle'): string =>
  `<text x="${x}" y="${y}" font-size="${S.font + 1}" font-weight="600" text-anchor="${anchor}" fill="${S.ink}">${esc(c.ref)}</text>`;
const valText = (s: string, x: number, y: number, anchor = 'middle'): string =>
  `<text x="${x}" y="${y}" font-size="${S.font}" text-anchor="${anchor}" fill="${S.muted}">${esc(s)}</text>`;

interface Drawn {
  svg: string;
  w: number;
  h: number;
}

/** Two-terminal part drawn vertically: pin1 top, pin2 bottom. */
const twoTerminal = (c: Component, kind: 'R' | 'C' | 'D' | 'LED' | 'PAD'): Drawn => {
  const w = S.cellW, h = S.cellH;
  const cx = 40, top = 14, bot = h - 14;
  const [p1, p2] = c.pins;
  let body = '';
  const my = (top + bot) / 2;
  if (kind === 'R') body = `<rect x="${cx - 5}" y="${my - 13}" width="10" height="26" fill="${S.body}" stroke="${S.ink}" stroke-width="1.2"/>` + line(cx, top, cx, my - 13) + line(cx, my + 13, cx, bot);
  if (kind === 'C') body = line(cx, top, cx, my - 3) + line(cx - 10, my - 3, cx + 10, my - 3) + line(cx - 10, my + 3, cx + 10, my + 3) + line(cx, my + 3, cx, bot);
  if (kind === 'D' || kind === 'LED') {
    // pin1 = cathode (top) for our parts: triangle points up (anode bottom -> cathode top)
    body = line(cx, top, cx, my - 7) + line(cx - 8, my - 7, cx + 8, my - 7) + `<path d="M${cx - 8},${my + 7}L${cx + 8},${my + 7}L${cx},${my - 7}Z" fill="${S.body}" stroke="${S.ink}" stroke-width="1.2"/>` + line(cx, my + 7, cx, bot);
    if (kind === 'LED') body += `<path d="M${cx + 10},${my - 2}l7,-7m-3,0h3v3M${cx + 10},${my + 4}l7,-7m-3,0h3v3" stroke="${S.ink}" fill="none" stroke-width="0.9"/>`;
  }
  if (kind === 'PAD') body = `<circle cx="${cx}" cy="${top + 8}" r="4" fill="none" stroke="${S.ink}" stroke-width="1.2"/><circle cx="${cx}" cy="${bot - 8}" r="4" fill="none" stroke="${S.ink}" stroke-width="1.2"/>` + line(cx, top, cx, top + 4) + line(cx, bot - 4, cx, bot) + line(cx, top + 12, cx, bot - 12);
  const texts = refText(c, cx + 22, my - 4, 'start') + valText(c.part.category === 'pad' ? `${p1.name}/${p2.name}` : c.value, cx + 22, my + 8, 'start');
  return { svg: body + texts + netTerminal(p1.net, cx, top, 'u') + netTerminal(p2.net, cx, bot, 'd'), w, h };
};

const mosfet = (c: Component): Drawn => {
  const w = S.cellW, h = S.cellH + 10;
  const g = c.pins.find((p) => p.name === 'G') as PinDef;
  const d = c.pins.find((p) => p.name === 'D') as PinDef;
  const s = c.pins.find((p) => p.name === 'S') as PinDef;
  const x = 50, y = h / 2;
  const svg =
    line(x - 24, y, x - 6, y) + line(x - 6, y - 12, x - 6, y + 12) +
    line(x - 2, y - 14, x - 2, y - 6) + line(x - 2, y - 3, x - 2, y + 3) + line(x - 2, y + 6, x - 2, y + 14) +
    line(x - 2, y - 10, x + 10, y - 10) + line(x + 10, y - 10, x + 10, y - 26) +
    line(x - 2, y + 10, x + 10, y + 10) + line(x + 10, y + 10, x + 10, y + 26) +
    line(x - 2, y, x + 10, y) + line(x + 10, y, x + 10, y + 10) +
    `<path d="M${x - 1},${y}l6,-3v6z" fill="${S.ink}"/>` +
    refText(c, x + 18, y - 2, 'start') + valText(c.value, x + 18, y + 10, 'start') +
    netTerminal(g.net, x - 24, y, 'l') + netTerminal(d.net, x + 10, y - 26, 'u') + netTerminal(s.net, x + 10, y + 26, 'd');
  return { svg, w, h };
};

const icBox = (c: Component): Drawn => {
  const pins = c.pins;
  const half = Math.ceil(pins.length / 2);
  const left = pins.slice(0, half);
  const right = pins.slice(half);
  const nameW = Math.max(...pins.map((p) => p.name.length)) * 5.5 + 10;
  const boxW = Math.max(70, nameW * 2 + 10);
  const labelW = 70;
  const boxH = Math.max(left.length, right.length) * S.pinPitch + 16;
  const x0 = labelW + S.stub, y0 = 22;
  let svg = `<rect x="${x0}" y="${y0}" width="${boxW}" height="${boxH}" fill="${S.body}" stroke="${S.ink}" stroke-width="1.2"/>`;
  svg += refText(c, x0 + boxW / 2, 12) + valText(c.part.mpn, x0 + boxW / 2, y0 + boxH + 12);
  left.forEach((p, i) => {
    const y = y0 + 12 + i * S.pinPitch;
    svg += line(x0 - S.stub, y, x0, y) + `<text x="${x0 + 4}" y="${y + 3}" font-size="${S.font - 1}" fill="${S.ink}">${esc(p.name)}</text>` +
      `<text x="${x0 - 3}" y="${y - 2}" font-size="7" text-anchor="end" fill="${S.muted}">${esc(p.num)}</text>` + netTerminal(p.net, x0 - S.stub, y, 'l');
  });
  right.forEach((p, i) => {
    const y = y0 + 12 + i * S.pinPitch;
    const xr = x0 + boxW;
    svg += line(xr, y, xr + S.stub, y) + `<text x="${xr - 4}" y="${y + 3}" font-size="${S.font - 1}" text-anchor="end" fill="${S.ink}">${esc(p.name)}</text>` +
      `<text x="${xr + 3}" y="${y - 2}" font-size="7" fill="${S.muted}">${esc(p.num)}</text>` + netTerminal(p.net, xr + S.stub, y, 'r');
  });
  return { svg, w: x0 + boxW + S.stub + labelW, h: y0 + boxH + 20 };
};

const drawComponent = (c: Component): Drawn | null => {
  switch (c.part.category) {
    case 'resistor': return twoTerminal(c, 'R');
    case 'capacitor': return twoTerminal(c, 'C');
    case 'diode': return twoTerminal(c, 'D');
    case 'led': return twoTerminal(c, 'LED');
    case 'pad': return twoTerminal(c, 'PAD');
    case 'switch': return twoTerminal(c, 'PAD');
    case 'mosfet': return mosfet(c);
    case 'mechanical': return null;
    default: return icBox(c);
  }
};

interface BlockDrawn {
  id: BlockId;
  svg: string;
  w: number;
  h: number;
}

const drawBlock = (id: BlockId, comps: Component[]): BlockDrawn => {
  const items = comps.map((c) => drawComponent(c)).filter((d): d is Drawn => d !== null);
  let x = S.blockPad, y = 30, rowH = 0;
  let svg = '';
  const maxW = Math.max(S.blockW, ...items.map((d) => d.w + 2 * S.blockPad));
  for (const d of items) {
    if (x + d.w > maxW - S.blockPad && x > S.blockPad) {
      x = S.blockPad;
      y += rowH + 8;
      rowH = 0;
    }
    svg += `<g transform="translate(${x} ${y})">${d.svg}</g>`;
    x += d.w + 6;
    rowH = Math.max(rowH, d.h);
  }
  const h = y + rowH + S.blockPad;
  const frame = `<rect x="0" y="0" width="${maxW}" height="${h}" rx="6" fill="#ffffff" stroke="#c3c2b7"/><text x="10" y="18" font-size="12" font-weight="700" fill="${S.ink}">${esc(BLOCK_TITLES[id])}</text>`;
  return { id, svg: frame + svg, w: maxW, h };
};

export const renderSchematicSvg = (c: Circuit, columns = 3): string => {
  const order: BlockId[] = ['power', 'mcu', 'sensors', 'motors', 'monitor', 'connectors'];
  const blocks = order.map((id) => drawBlock(id, c.components.filter((x) => x.block === id)));
  const colW = Math.max(...blocks.map((b) => b.w));
  const colH = new Array<number>(columns).fill(50);
  let body = '';
  for (const b of blocks) {
    const col = colH.indexOf(Math.min(...colH));
    body += `<g transform="translate(${S.gap + col * (colW + S.gap)} ${colH[col]})">${b.svg}</g>`;
    colH[col] += b.h + S.gap;
  }
  const W = S.gap + columns * (colW + S.gap);
  const H = Math.max(...colH) + 10;
  const title = `<text x="${S.gap}" y="30" font-size="16" font-weight="700" fill="${S.ink}">${esc(c.name)} 回路図</text><text x="${W - S.gap}" y="30" font-size="10" text-anchor="end" fill="${S.muted}">ネットラベル方式：同じ名前のラベル同士が接続。赤＝電源、青の接地記号＝GND、× は未接続（NC）</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="system-ui, 'Segoe UI', 'Yu Gothic UI', sans-serif"><rect width="${W}" height="${H}" fill="#f9f9f7"/>${title}${body}</svg>`;
};
