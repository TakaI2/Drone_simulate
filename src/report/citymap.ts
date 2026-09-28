import type { Vec3 } from '../core/math';
import type { SkyMap } from '../core/types';
import type { CityBuilding, XY } from '../geo/city';

export interface CityMapOptions {
  title: string;
  halfSize: number;
  buildings: CityBuilding[];
  parks?: Array<{ name: string; ring: XY[] }>;
  /** Open-sky fraction layer drawn under the buildings (sequential single-hue ramp). */
  sky?: { map: SkyMap; heightIndex: number };
  paths?: Array<{ name: string; pts: Vec3[]; color: string; dashed?: boolean }>;
  markers?: Array<{ p: XY; label: string }>;
  size?: number;
  /** Buildings taller than this get their height printed [m]. */
  labelAbove?: number;
}

/** Top-view city map (SVG string): north up, east right, 100 m grid, legend. */
export const renderCityMapSvg = (o: CityMapOptions): string => {
  const W = o.size ?? 760;
  const pad = 36;
  const s = (W - 2 * pad) / (2 * o.halfSize);
  const X = (x: number): number => pad + (x + o.halfSize) * s;
  const Y = (y: number): number => pad + (o.halfSize - y) * s;
  const pts = (fp: XY[]): string => fp.map((p) => `${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ');
  const parts: string[] = [];
  parts.push(`<rect x="${pad}" y="${pad}" width="${W - 2 * pad}" height="${W - 2 * pad}" fill="#f4f3ef"/>`);
  if (o.sky) {
    const m = o.sky.map;
    const k = o.sky.heightIndex;
    const c = m.spacing * s;
    for (let j = 0; j < m.ny; j++)
      for (let i = 0; i < m.nx; i++) {
        const f = m.data[(k * m.ny + j) * m.nx + i];
        // darker = less open sky (sequential blue ramp)
        const t = 1 - Math.max(0, Math.min(1, f));
        const r = Math.round(244 - t * 190), g = Math.round(243 - t * 150), b = Math.round(239 - t * 40);
        parts.push(`<rect x="${(X(m.x0 + i * m.spacing) - c / 2).toFixed(1)}" y="${(Y(m.y0 + j * m.spacing) - c / 2).toFixed(1)}" width="${c.toFixed(1)}" height="${c.toFixed(1)}" fill="rgb(${r},${g},${b})"/>`);
      }
  }
  for (let g = -o.halfSize; g <= o.halfSize; g += 100) {
    parts.push(`<line x1="${X(g)}" y1="${pad}" x2="${X(g)}" y2="${W - pad}" stroke="#d6d4cc" stroke-width="0.6"/>`);
    parts.push(`<line x1="${pad}" y1="${Y(g)}" x2="${W - pad}" y2="${Y(g)}" stroke="#d6d4cc" stroke-width="0.6"/>`);
    parts.push(`<text x="${X(g)}" y="${W - pad + 14}" font-size="10" text-anchor="middle" fill="#6b6a66">${g}</text>`);
    parts.push(`<text x="${pad - 4}" y="${Y(g) + 3}" font-size="10" text-anchor="end" fill="#6b6a66">${g}</text>`);
  }
  for (const pk of o.parks ?? []) parts.push(`<polygon points="${pts(pk.ring)}" fill="#9fd39a" fill-opacity="0.55" stroke="#5a9d55" stroke-width="0.6"><title>${pk.name}</title></polygon>`);
  for (const b of o.buildings) {
    const shade = Math.round(200 - Math.min(1, b.zMax / 200) * 150);
    parts.push(`<polygon points="${pts(b.footprint)}" fill="rgb(${shade},${shade},${shade + 8})" stroke="#3b3a36" stroke-width="0.4"><title>${b.name ?? b.id} ${b.zMax.toFixed(0)} m</title></polygon>`);
  }
  for (const b of o.buildings.filter((q) => q.zMax >= (o.labelAbove ?? 80))) {
    const c = { x: b.footprint.reduce((a, p) => a + p.x, 0) / b.footprint.length, y: b.footprint.reduce((a, p) => a + p.y, 0) / b.footprint.length };
    parts.push(`<text x="${X(c.x)}" y="${Y(c.y) + 3}" font-size="9" text-anchor="middle" fill="#ffffff">${b.zMax.toFixed(0)}</text>`);
  }
  for (const p of o.paths ?? []) parts.push(`<polyline points="${p.pts.map((q) => `${X(q.x).toFixed(1)},${Y(q.y).toFixed(1)}`).join(' ')}" fill="none" stroke="${p.color}" stroke-width="2" ${p.dashed ? 'stroke-dasharray="6 4"' : ''}/>`);
  for (const m of o.markers ?? []) parts.push(`<circle cx="${X(m.p.x)}" cy="${Y(m.p.y)}" r="5" fill="#0b0b0b"/><text x="${X(m.p.x) + 8}" y="${Y(m.p.y) + 4}" font-size="12" fill="#0b0b0b">${m.label}</text>`);
  const legend = (o.paths ?? []).map((p, i) => `<g transform="translate(${pad + i * 190},${pad - 12})"><line x1="0" y1="0" x2="22" y2="0" stroke="${p.color}" stroke-width="2" ${p.dashed ? 'stroke-dasharray="6 4"' : ''}/><text x="28" y="4" font-size="11" fill="#0b0b0b">${p.name}</text></g>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${W + 8}" width="100%" style="max-width:${W}px;font-family:system-ui,sans-serif"><text x="${pad}" y="14" font-size="13" font-weight="600" fill="#0b0b0b">${o.title}</text>${legend}${parts.join('')}<text x="${W - pad}" y="${W - 4}" font-size="10" text-anchor="end" fill="#6b6a66">x: 東 [m] / y: 北 [m]</text></svg>`;
};
