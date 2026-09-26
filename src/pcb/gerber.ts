import { textStrokes } from './font';
import { courtyardRect, transformPoint } from './geometry';
import type { Layer, PcbDesign, PlacedPad } from './types';

/**
 * Gerber RS-274X (with X2 file attributes) + Excellon writers.
 * Output origin: board lower-left corner = (0, 0), units mm, format 4.6.
 */

const fmtCoord = (mm: number): string => String(Math.round(mm * 1e6));

interface Ap {
  code: number;
  def: string;
}

const createWriter = (fileFunction: string, polarity: 'Positive' | 'Negative' = 'Positive') => {
  const apertures = new Map<string, Ap>();
  const body: string[] = [];
  let next = 10;
  let current = -1;
  const ap = (def: string): number => {
    let a = apertures.get(def);
    if (!a) {
      a = { code: next++, def };
      apertures.set(def, a);
    }
    return a.code;
  };
  const select = (code: number): void => {
    if (code !== current) {
      body.push(`D${code}*`);
      current = code;
    }
  };
  const circle = (d: number): number => ap(`C,${d.toFixed(4)}`);
  const rect = (w: number, h: number): number => ap(`R,${w.toFixed(4)}X${h.toFixed(4)}`);
  const obround = (w: number, h: number): number => ap(`O,${w.toFixed(4)}X${h.toFixed(4)}`);
  const flash = (code: number, x: number, y: number): void => {
    select(code);
    body.push(`X${fmtCoord(x)}Y${fmtCoord(y)}D03*`);
  };
  const line = (code: number, x1: number, y1: number, x2: number, y2: number): void => {
    select(code);
    body.push(`X${fmtCoord(x1)}Y${fmtCoord(y1)}D02*`, `X${fmtCoord(x2)}Y${fmtCoord(y2)}D01*`);
  };
  const region = (pts: Array<[number, number]>): void => {
    body.push('G36*', `X${fmtCoord(pts[0][0])}Y${fmtCoord(pts[0][1])}D02*`);
    for (let i = 1; i < pts.length; i++) body.push(`X${fmtCoord(pts[i][0])}Y${fmtCoord(pts[i][1])}D01*`);
    body.push(`X${fmtCoord(pts[0][0])}Y${fmtCoord(pts[0][1])}D01*`, 'G37*');
  };
  const toString = (): string => {
    const head = [
      'G04 Drone Design Studio PCB export*',
      '%TF.GenerationSoftware,DroneDesignStudio,drone-design-studio,0.1*%',
      `%TF.FileFunction,${fileFunction}*%`,
      `%TF.FilePolarity,${polarity}*%`,
      '%FSLAX46Y46*%',
      '%MOMM*%',
      '%LPD*%',
      'G01*',
      ...[...apertures.values()].map((a) => `%ADD${a.code}${a.def}*%`),
    ];
    return [...head, ...body, 'M02*', ''].join('\n');
  };
  return { circle, rect, obround, flash, line, region, toString };
};

export interface GerberSet {
  files: Record<string, string>;
  /** Pick-and-place (CPL) CSV. */
  cpl: string;
}

export const generateGerbers = (d: PcbDesign, values: Record<string, string> = {}, silkTexts: string[] = []): GerberSet => {
  const ox = d.board.w / 2, oy = d.board.h / 2;
  const X = (x: number): number => x + ox;
  const Y = (y: number): number => y + oy;
  const name = 'drone_fc';
  const files: Record<string, string> = {};

  const padFlash = (w: ReturnType<typeof createWriter>, p: PlacedPad, grow: number): void => {
    const ww = p.w + 2 * grow, hh = p.h + 2 * grow;
    const code = p.shape === 'circle' ? w.circle(ww) : p.shape === 'oval' ? w.obround(ww, hh) : w.rect(ww, hh);
    w.flash(code, X(p.x), Y(p.y));
  };

  // ---------------- copper ----------------
  for (const L of ['F', 'B'] as Layer[]) {
    const w = createWriter(L === 'F' ? 'Copper,L1,Top' : 'Copper,L2,Bot');
    for (const z of d.zones.filter((q) => q.layer === L)) for (const rc of z.rects) region([[X(rc.x), Y(rc.y)], [X(rc.x + rc.w), Y(rc.y)], [X(rc.x + rc.w), Y(rc.y + rc.h)], [X(rc.x), Y(rc.y + rc.h)]], w);
    for (const t of d.tracks.filter((q) => q.layer === L)) w.line(w.circle(t.width), X(t.x1), Y(t.y1), X(t.x2), Y(t.y2));
    for (const p of d.pads) if (!p.npth && p.layers.includes(L)) padFlash(w, p, 0);
    for (const v of d.vias) w.flash(w.circle(v.d), X(v.x), Y(v.y));
    files[`${name}-${L}_Cu.${L === 'F' ? 'gtl' : 'gbl'}`] = w.toString();
  }
  function region(pts: Array<[number, number]>, w: ReturnType<typeof createWriter>): void {
    w.region(pts);
  }

  // ---------------- solder mask (openings; vias tented) ----------------
  for (const L of ['F', 'B'] as Layer[]) {
    const w = createWriter(L === 'F' ? 'Soldermask,Top' : 'Soldermask,Bot', 'Negative');
    for (const p of d.pads) if (p.layers.includes(L) || p.npth) padFlash(w, p, d.rules.maskExpansion);
    files[`${name}-${L}_Mask.${L === 'F' ? 'gts' : 'gbs'}`] = w.toString();
  }

  // ---------------- paste (SMD only) ----------------
  {
    const w = createWriter('Paste,Top');
    for (const p of d.pads) if (!p.drill && p.layers.includes('F')) padFlash(w, p, 0);
    files[`${name}-F_Paste.gtp`] = w.toString();
  }

  // ---------------- silkscreen ----------------
  {
    const w = createWriter('Legend,Top');
    const pen = w.circle(d.rules.silkWidth);
    for (const pl of d.placements) {
      if (pl.pkg.family === 'mechanical' || pl.pkg.family === 'pad') continue;
      const rc = courtyardRect(pl, -0.15);
      const pts: Array<[number, number]> = [[rc.x, rc.y], [rc.x + rc.w, rc.y], [rc.x + rc.w, rc.y + rc.h], [rc.x, rc.y + rc.h], [rc.x, rc.y]];
      for (let i = 1; i < pts.length; i++) w.line(pen, X(pts[i - 1][0]), Y(pts[i - 1][1]), X(pts[i][0]), Y(pts[i][1]));
      // pin-1 marker
      const p1 = pl.pkg.pads.find((p) => p.num === '1');
      if (p1) {
        const c = transformPoint(pl, p1.x, p1.y);
        const dx = c.x - pl.x, dy = c.y - pl.y, l = Math.hypot(dx, dy) || 1;
        const mx = c.x + (dx / l) * 0.7, my = c.y + (dy / l) * 0.7;
        w.flash(w.circle(0.3), X(mx), Y(my));
      }
      const h = Math.min(0.8, Math.max(0.5, rc.h * 0.35));
      for (const s of textStrokes(pl.ref, pl.x, rc.y + rc.h + h * 0.7, h)) w.line(pen, X(s.x1), Y(s.y1), X(s.x2), Y(s.y2));
    }
    silkTexts.forEach((t, i) => {
      for (const s of textStrokes(t, 0, -d.board.h / 2 + 1.2 + i * 1.3, 0.9)) w.line(pen, X(s.x1), Y(s.y1), X(s.x2), Y(s.y2));
    });
    files[`${name}-F_Silkscreen.gto`] = w.toString();
  }

  // ---------------- board outline ----------------
  {
    const w = createWriter('Profile,NP');
    const pen = w.circle(0.1);
    const hw = d.board.w / 2, hh = d.board.h / 2, r = d.board.cornerRadius;
    const pts: Array<[number, number]> = [];
    const arc = (cx: number, cy: number, a0: number): void => {
      for (let k = 0; k <= 8; k++) {
        const a = a0 + (k / 8) * (Math.PI / 2);
        pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
      }
    };
    arc(hw - r, -hh + r, -Math.PI / 2);
    arc(hw - r, hh - r, 0);
    arc(-hw + r, hh - r, Math.PI / 2);
    arc(-hw + r, -hh + r, Math.PI);
    pts.push(pts[0]);
    for (let i = 1; i < pts.length; i++) w.line(pen, X(pts[i - 1][0]), Y(pts[i - 1][1]), X(pts[i][0]), Y(pts[i][1]));
    files[`${name}-Edge_Cuts.gm1`] = w.toString();
  }

  // ---------------- drills (Excellon, metric, decimal) ----------------
  const drill = (plated: boolean): string => {
    const holes: Array<{ x: number; y: number; d: number }> = [];
    if (plated) for (const v of d.vias) holes.push({ x: v.x, y: v.y, d: v.drill });
    for (const p of d.pads) if (p.drill && !!p.npth !== plated) holes.push({ x: p.x, y: p.y, d: p.drill });
    const sizes = [...new Set(holes.map((h) => h.d.toFixed(3)))].sort();
    const lines = ['M48', `; Drone Design Studio ${plated ? 'PTH' : 'NPTH'} drill file`, `; #@! TF.FileFunction,${plated ? 'Plated,1,2,PTH' : 'NonPlated,1,2,NPTH'}`, 'FMAT,2', 'METRIC'];
    sizes.forEach((s, i) => lines.push(`T${i + 1}C${s}`));
    lines.push('%', 'G90', 'G05');
    sizes.forEach((s, i) => {
      lines.push(`T${i + 1}`);
      for (const h of holes.filter((q) => q.d.toFixed(3) === s)) lines.push(`X${X(h.x).toFixed(3)}Y${Y(h.y).toFixed(3)}`);
    });
    lines.push('M30', '');
    return lines.join('\n');
  };
  files[`${name}-PTH.drl`] = drill(true);
  files[`${name}-NPTH.drl`] = drill(false);

  // ---------------- pick & place ----------------
  const cplRows = ['Designator,Val,Package,Mid X,Mid Y,Rotation,Layer'];
  for (const pl of d.placements) {
    if (pl.pkg.family === 'mechanical' || pl.pkg.family === 'pad') continue;
    cplRows.push(`${pl.ref},"${(values[pl.ref] ?? '').replace(/"/g, '""')}",${pl.pkg.id},${X(pl.x).toFixed(3)}mm,${Y(pl.y).toFixed(3)}mm,${pl.rot},top`);
  }
  return { files, cpl: cplRows.join('\r\n') + '\r\n' };
};

// ---------------- minimal ZIP (store, no compression) ----------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

const crc32 = (buf: Uint8Array): number => {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

export const zipStore = (entries: Record<string, string | Uint8Array>): Uint8Array => {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const data = typeof content === 'string' ? enc.encode(content) : content;
    const nameBytes = enc.encode(name);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(8, 0, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);
    chunks.push(new Uint8Array(local.buffer), nameBytes, data);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true);
    cen.setUint16(4, 20, true);
    cen.setUint16(6, 20, true);
    cen.setUint16(8, 0x0800, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, data.length, true);
    cen.setUint32(24, data.length, true);
    cen.setUint16(28, nameBytes.length, true);
    cen.setUint32(42, offset, true);
    central.push(new Uint8Array(cen.buffer), nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const cenSize = central.reduce((s, c) => s + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, Object.keys(entries).length, true);
  end.setUint16(10, Object.keys(entries).length, true);
  end.setUint32(12, cenSize, true);
  end.setUint32(16, offset, true);
  const all = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((s, c) => s + c.length, 0));
  let p = 0;
  for (const c of all) {
    out.set(c, p);
    p += c.length;
  }
  return out;
};
