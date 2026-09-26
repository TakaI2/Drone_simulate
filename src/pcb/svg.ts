import { courtyardRect } from './geometry';
import type { PcbDesign } from './types';

export interface PcbSvgOptions {
  layers?: Array<'F' | 'B'>;
  scale?: number;
  showPour?: boolean;
  showSilk?: boolean;
  showRefs?: boolean;
  title?: string;
  highlightNets?: string[];
}

const COLORS = {
  board: '#10331f',
  edge: '#e8e8e8',
  F: '#c83434',
  B: '#3465c8',
  pourF: 'rgba(200,52,52,0.28)',
  pourB: 'rgba(52,101,200,0.28)',
  thermalF: 'rgba(200,52,52,0.55)',
  thermalB: 'rgba(52,101,200,0.55)',
  pad: '#d9b64a',
  via: '#c0c0c0',
  hole: '#000000',
  silk: '#f2f2f2',
  keepout: 'rgba(255,255,0,0.15)',
};

/** Top-view SVG of the board (y up in design coords -> flipped for SVG). */
export const renderPcbSvg = (d: PcbDesign, o: PcbSvgOptions = {}): string => {
  const layers = o.layers ?? ['B', 'F'];
  const s = o.scale ?? 20;
  const W = d.board.w, H = d.board.h;
  const margin = 8;
  const vw = (W + 2 * margin) * s, vh = (H + 2 * margin) * s;
  const X = (x: number): number => (x + W / 2 + margin) * s;
  const Y = (y: number): number => (H / 2 - y + margin) * s;
  const parts: string[] = [];
  parts.push(`<rect x="0" y="0" width="${vw}" height="${vh}" fill="#1a1a19"/>`);
  parts.push(`<rect x="${X(-W / 2)}" y="${Y(H / 2)}" width="${W * s}" height="${H * s}" rx="${d.board.cornerRadius * s}" fill="${COLORS.board}" stroke="${COLORS.edge}" stroke-width="${0.1 * s}"/>`);
  for (const k of d.keepouts) parts.push(`<rect x="${X(k.x)}" y="${Y(k.y + k.h)}" width="${k.w * s}" height="${k.h * s}" fill="${COLORS.keepout}" stroke="#ffe066" stroke-dasharray="4 3"/>`);
  const hl = new Set(o.highlightNets ?? []);
  for (const L of layers) {
    if (o.showPour !== false) {
      for (const z of d.zones.filter((q) => q.layer === L)) {
        const fill = z.kind === 'pour' ? (L === 'F' ? COLORS.pourF : COLORS.pourB) : L === 'F' ? COLORS.thermalF : COLORS.thermalB;
        const path = z.rects.map((rc) => `M${X(rc.x).toFixed(1)},${Y(rc.y + rc.h).toFixed(1)}h${(rc.w * s).toFixed(1)}v${(rc.h * s).toFixed(1)}h${(-rc.w * s).toFixed(1)}z`).join('');
        parts.push(`<path d="${path}" fill="${fill}"/>`);
      }
    }
    const col = L === 'F' ? COLORS.F : COLORS.B;
    for (const t of d.tracks.filter((q) => q.layer === L)) {
      const c = hl.size && hl.has(t.net) ? '#ffe066' : col;
      parts.push(`<line x1="${X(t.x1).toFixed(1)}" y1="${Y(t.y1).toFixed(1)}" x2="${X(t.x2).toFixed(1)}" y2="${Y(t.y2).toFixed(1)}" stroke="${c}" stroke-width="${(t.width * s).toFixed(1)}" stroke-linecap="round"/>`);
    }
  }
  for (const p of d.pads) {
    if (p.npth) {
      parts.push(`<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="${((p.drill ?? p.w) / 2) * s}" fill="${COLORS.hole}" stroke="#555"/>`);
      continue;
    }
    if (!p.layers.some((l) => layers.includes(l))) continue;
    if (p.shape === 'circle') parts.push(`<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="${(p.w / 2) * s}" fill="${COLORS.pad}"/>`);
    else parts.push(`<rect x="${X(p.x - p.w / 2)}" y="${Y(p.y + p.h / 2)}" width="${p.w * s}" height="${p.h * s}" rx="${p.shape === 'roundrect' ? Math.min(p.w, p.h) * 0.25 * s : 0}" fill="${COLORS.pad}"/>`);
    if (p.drill) parts.push(`<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="${(p.drill / 2) * s}" fill="${COLORS.hole}"/>`);
  }
  for (const v of d.vias) {
    parts.push(`<circle cx="${X(v.x)}" cy="${Y(v.y)}" r="${(v.d / 2) * s}" fill="${COLORS.via}"/><circle cx="${X(v.x)}" cy="${Y(v.y)}" r="${(v.drill / 2) * s}" fill="${COLORS.hole}"/>`);
  }
  if (o.showSilk !== false) {
    for (const pl of d.placements) {
      if (pl.pkg.family === 'mechanical') continue;
      const rc = courtyardRect(pl);
      parts.push(`<rect x="${X(rc.x)}" y="${Y(rc.y + rc.h)}" width="${rc.w * s}" height="${rc.h * s}" fill="none" stroke="${COLORS.silk}" stroke-opacity="0.35" stroke-width="${0.06 * s}"/>`);
      if (o.showRefs !== false) parts.push(`<text x="${X(pl.x)}" y="${Y(pl.y) + 0.25 * s}" font-size="${Math.min(0.9, rc.h * 0.45) * s}" fill="${COLORS.silk}" text-anchor="middle" font-family="monospace" opacity="0.9">${pl.ref}</text>`);
    }
  }
  if (o.title) parts.push(`<text x="${12}" y="${24}" font-size="18" fill="#fff" font-family="system-ui">${o.title}</text>`);
  // scale bar 10 mm
  parts.push(`<line x1="${X(-W / 2)}" y1="${vh - 0.3 * margin * s}" x2="${X(-W / 2 + 10)}" y2="${vh - 0.3 * margin * s}" stroke="#fff" stroke-width="2"/><text x="${X(-W / 2 + 10) + 6}" y="${vh - 0.3 * margin * s + 5}" fill="#fff" font-size="14" font-family="system-ui">10 mm</text>`);
  parts.push(`<text x="${X(W / 2)}" y="${vh - 0.3 * margin * s + 5}" fill="#fff" font-size="14" text-anchor="end" font-family="system-ui">↑ +y（左） → +x（機首）</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vw} ${vh}" width="${vw}" height="${vh}">${parts.join('')}</svg>`;
};
