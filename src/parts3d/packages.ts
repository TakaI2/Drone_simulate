/**
 * Package definitions: ONE dimensional source for both the PCB footprint (pads) and the 3D body.
 * Units: mm. Origin: package center on the board surface, +x right, +y up (top view), +z out of the board.
 * Land patterns follow common IPC-7351 nominal values (as used by the KiCad standard libraries);
 * packages flagged `verify` are approximations that must be checked against the manufacturer drawing.
 */

export type PadShape = 'rect' | 'roundrect' | 'circle' | 'oval';

export interface Pad {
  num: string;
  x: number;
  y: number;
  w: number;
  h: number;
  shape: PadShape;
  /** Plated drill diameter for through-hole pads. */
  drill?: number;
  /** Non-plated hole (mechanical). */
  npth?: boolean;
}

export interface BodyPrim {
  kind: 'box' | 'cyl';
  /** Center of the primitive. */
  c: [number, number, number];
  /** box: [sx, sy, sz]; cyl: [radius, radius, length]. */
  s: [number, number, number];
  /** Cylinder axis. */
  axis?: 'x' | 'y' | 'z';
  color: number;
  metal?: boolean;
}

export interface PackageDef {
  id: string;
  family: string;
  description: string;
  /** Standard / reference drawing the dimensions come from. */
  standard: string;
  pads: Pad[];
  body: BodyPrim[];
  /** Courtyard half extents (placement keep-out, includes pads) [mm]. */
  courtyard: { w: number; h: number };
  /** Top of body above board [mm]. */
  height: number;
  /** Approximate footprint (check against datasheet). */
  verify?: boolean;
  /** Region under the part where copper of other nets is forbidden (e.g. antenna). */
  keepout?: Array<{ x: number; y: number; w: number; h: number }>;
  /** Body overhang beyond board edge allowed (antenna). */
  overhang?: { side: 'left' | 'right' | 'top' | 'bottom'; length: number };
  /** Top-layer routing keep-out under the body (package coords, rect center + size). */
  routeKeepout?: Array<{ x: number; y: number; w: number; h: number }>;
  /** Via keep-out under the body (package coords). */
  viaKeepout?: Array<{ x: number; y: number; w: number; h: number }>;
  /** Pads need escape (fan-out) routing before general routing. */
  fanout?: boolean;
}

const COL = {
  ceramic: 0xc9b38f,
  resistor: 0x1b1b1b,
  metal: 0xd9d9d9,
  black: 0x222222,
  shield: 0xb8bcc2,
  pcbModule: 0x1f3f7a,
  led: 0xff3b30,
  white: 0xf2f2f2,
  beige: 0xe8dcc0,
  blue: 0x2e6bd6,
  green: 0x2f7d32,
  electrolytic: 0x1d3d8f,
  brown: 0x8d5a2b,
  copper: 0xc87533,
  gold: 0xd4af37,
};

const courtyardOf = (pads: Pad[], body: BodyPrim[], margin = 0.25): { w: number; h: number } => {
  let mx = 0, my = 0;
  for (const p of pads) {
    mx = Math.max(mx, Math.abs(p.x) + p.w / 2);
    my = Math.max(my, Math.abs(p.y) + p.h / 2);
  }
  for (const b of body) {
    const hx = b.kind === 'box' ? b.s[0] / 2 : b.axis === 'x' ? b.s[2] / 2 : b.s[0];
    const hy = b.kind === 'box' ? b.s[1] / 2 : b.axis === 'y' ? b.s[2] / 2 : b.s[0];
    mx = Math.max(mx, Math.abs(b.c[0]) + hx);
    my = Math.max(my, Math.abs(b.c[1]) + hy);
  }
  return { w: mx + margin, h: my + margin };
};

const finish = (d: Omit<PackageDef, 'courtyard' | 'height'> & { courtyardMargin?: number }): PackageDef => {
  const height = Math.max(0, ...d.body.map((b) => b.c[2] + (b.kind === 'box' ? b.s[2] / 2 : b.axis === 'z' ? b.s[2] / 2 : b.s[0])));
  return { ...d, courtyard: courtyardOf(d.pads, d.body, d.courtyardMargin ?? 0.25), height };
};

// ------------------------------------------------------------------ SMD chip (R/C/L/LED)
interface ChipDims { L: number; W: number; H: number; term: number; padW: number; padH: number; padX: number }
const CHIP: Record<string, ChipDims> = {
  '0402': { L: 1.0, W: 0.5, H: 0.35, term: 0.25, padW: 0.54, padH: 0.64, padX: 0.51 },
  '0603': { L: 1.6, W: 0.8, H: 0.45, term: 0.3, padW: 0.8, padH: 0.95, padX: 0.825 },
  '0805': { L: 2.0, W: 1.25, H: 0.6, term: 0.4, padW: 1.025, padH: 1.4, padX: 0.9125 },
  '1206': { L: 3.2, W: 1.6, H: 0.6, term: 0.5, padW: 1.125, padH: 1.75, padX: 1.4625 },
  '1210': { L: 3.2, W: 2.5, H: 0.6, term: 0.5, padW: 1.125, padH: 2.65, padX: 1.4625 },
};

export const chip = (kind: 'R' | 'C' | 'L' | 'LED', size: keyof typeof CHIP, bodyH?: number): PackageDef => {
  const d = CHIP[size];
  const H = bodyH ?? (kind === 'C' ? d.W : kind === 'L' ? d.W : d.H);
  const bodyColor = kind === 'R' ? COL.resistor : kind === 'C' ? COL.ceramic : kind === 'L' ? 0x555555 : COL.white;
  const body: BodyPrim[] = [
    { kind: 'box', c: [0, 0, H / 2], s: [d.L - 2 * d.term, d.W, H], color: bodyColor },
    { kind: 'box', c: [-(d.L - d.term) / 2, 0, H / 2], s: [d.term, d.W, H], color: COL.metal, metal: true },
    { kind: 'box', c: [(d.L - d.term) / 2, 0, H / 2], s: [d.term, d.W, H], color: COL.metal, metal: true },
  ];
  if (kind === 'LED') body.push({ kind: 'box', c: [0, 0, H + 0.05], s: [d.L * 0.5, d.W * 0.8, 0.1], color: COL.led });
  const idPrefix = kind === 'LED' ? 'LED' : kind;
  return finish({
    id: `${idPrefix}${size}`,
    family: 'chip',
    description: `${kind === 'R' ? 'チップ抵抗' : kind === 'C' ? '積層セラミックコンデンサ' : kind === 'L' ? 'チップインダクタ' : 'チップ LED'} ${size}（メートル ${Math.round(d.L * 10)}${String(Math.round(d.W * 10)).padStart(2, '0')}）`,
    standard: `EIA ${size} / IPC-7351 nominal`,
    pads: [
      { num: '1', x: -d.padX, y: 0, w: d.padW, h: d.padH, shape: 'roundrect' },
      { num: '2', x: d.padX, y: 0, w: d.padW, h: d.padH, shape: 'roundrect' },
    ],
    body,
  });
};

// ------------------------------------------------------------------ gull-wing small outline (SOT / SOIC)
const gullBody = (L: number, W: number, H: number, leads: Array<[number, number, 'l' | 'r']>, leadLen: number, leadW: number, color = COL.black): BodyPrim[] => {
  const body: BodyPrim[] = [{ kind: 'box', c: [0, 0, 0.1 + H / 2], s: [L, W, H], color }];
  for (const [x, y, side] of leads) {
    const cx = side === 'l' ? x + leadLen / 2 : x - leadLen / 2;
    body.push({ kind: 'box', c: [cx, y, 0.1], s: [leadLen, leadW, 0.15], color: COL.metal, metal: true });
  }
  return body;
};

export const sot23 = (pins: 3 | 5 | 6): PackageDef => {
  const padX = 1.1375, pitch = 0.95;
  const pads: Pad[] = [];
  if (pins === 3) {
    pads.push({ num: '1', x: -padX, y: pitch, w: 1.325, h: 0.6, shape: 'roundrect' });
    pads.push({ num: '2', x: -padX, y: -pitch, w: 1.325, h: 0.6, shape: 'roundrect' });
    pads.push({ num: '3', x: padX, y: 0, w: 1.325, h: 0.6, shape: 'roundrect' });
  } else {
    const left = [pitch, 0, -pitch];
    left.forEach((y, i) => pads.push({ num: String(i + 1), x: -padX, y, w: 1.325, h: 0.6, shape: 'roundrect' }));
    const right = pins === 5 ? [-pitch, pitch] : [-pitch, 0, pitch];
    right.forEach((y, i) => pads.push({ num: String(4 + i), x: padX, y, w: 1.325, h: 0.6, shape: 'roundrect' }));
  }
  const leads = pads.map((p): [number, number, 'l' | 'r'] => [p.x < 0 ? -1.4 : 1.4, p.y, p.x < 0 ? 'l' : 'r']);
  return finish({
    id: pins === 3 ? 'SOT-23' : `SOT-23-${pins}`,
    family: 'sot',
    description: `SOT-23${pins === 3 ? '' : `-${pins}`} 小型トランジスタ/IC パッケージ`,
    standard: 'JEDEC TO-236 / MO-178, IPC-7351 nominal',
    pads,
    body: gullBody(1.6, 2.9, 1.0, leads, 0.45, 0.4).map((b, i) => (i === 0 ? { ...b, s: [1.6, 2.9, 1.0] as [number, number, number] } : b)),
  });
};

export const sod123 = (): PackageDef =>
  finish({
    id: 'SOD-123',
    family: 'diode',
    description: 'SOD-123 小型ダイオード（1 番ピン＝カソード）',
    standard: 'JEDEC SOD-123, IPC-7351 nominal',
    pads: [
      { num: '1', x: -1.635, y: 0, w: 0.91, h: 1.22, shape: 'roundrect' },
      { num: '2', x: 1.635, y: 0, w: 0.91, h: 1.22, shape: 'roundrect' },
    ],
    body: [
      { kind: 'box', c: [0, 0, 0.6], s: [2.7, 1.6, 1.1], color: COL.black },
      { kind: 'box', c: [-1.0, 0, 1.16], s: [0.35, 1.6, 0.02], color: COL.white },
      { kind: 'box', c: [-1.6, 0, 0.1], s: [0.6, 0.6, 0.15], color: COL.metal, metal: true },
      { kind: 'box', c: [1.6, 0, 0.1], s: [0.6, 0.6, 0.15], color: COL.metal, metal: true },
    ],
  });

export const soic = (pins: number, pitch = 1.27, bodyW = 3.9): PackageDef => {
  const n = pins / 2;
  const span = (n - 1) * pitch;
  const pads: Pad[] = [];
  for (let i = 0; i < n; i++) pads.push({ num: String(i + 1), x: -2.7, y: span / 2 - i * pitch, w: 1.55, h: 0.6, shape: 'roundrect' });
  for (let i = 0; i < n; i++) pads.push({ num: String(n + i + 1), x: 2.7, y: -span / 2 + i * pitch, w: 1.55, h: 0.6, shape: 'roundrect' });
  const leads = pads.map((p): [number, number, 'l' | 'r'] => [p.x < 0 ? -3.0 : 3.0, p.y, p.x < 0 ? 'l' : 'r']);
  const body = gullBody(bodyW, span + 1.0, 1.45, leads, 1.05, 0.42);
  body.push({ kind: 'cyl', c: [-bodyW / 2 + 0.6, span / 2, 1.56], s: [0.25, 0.25, 0.02], axis: 'z', color: COL.white });
  return finish({ id: `SOIC-${pins}`, family: 'soic', description: `SOIC-${pins} 表面実装 IC`, standard: 'JEDEC MS-012, IPC-7351 nominal', pads, body });
};

// ------------------------------------------------------------------ leadless (LGA / QFN)
/** Perimeter pads, counter-clockwise from pin 1 at top-left of the left edge. counts = [left, bottom, right, top]. */
const perimeterPads = (bw: number, bh: number, pitch: number, padW: number, padL: number, counts: [number, number, number, number], inset: number): Pad[] => {
  const pads: Pad[] = [];
  let num = 1;
  const [nl, nb, nr, nt] = counts;
  for (let i = 0; i < nl; i++) pads.push({ num: String(num++), x: -bw / 2 + inset, y: ((nl - 1) / 2 - i) * pitch, w: padL, h: padW, shape: 'roundrect' });
  for (let i = 0; i < nb; i++) pads.push({ num: String(num++), x: (i - (nb - 1) / 2) * pitch, y: -bh / 2 + inset, w: padW, h: padL, shape: 'roundrect' });
  for (let i = 0; i < nr; i++) pads.push({ num: String(num++), x: bw / 2 - inset, y: (i - (nr - 1) / 2) * pitch, w: padL, h: padW, shape: 'roundrect' });
  for (let i = 0; i < nt; i++) pads.push({ num: String(num++), x: ((nt - 1) / 2 - i) * pitch, y: bh / 2 - inset, w: padW, h: padL, shape: 'roundrect' });
  return pads;
};

export const lga = (id: string, bw: number, bh: number, H: number, counts: [number, number, number, number], pitch = 0.5, desc = ''): PackageDef =>
  finish({
    id,
    family: 'lga',
    description: desc || `LGA ${bw}×${bh} mm`,
    standard: 'メーカー推奨ランドパターン（近似）',
    pads: perimeterPads(bw, bh, pitch, 0.25, 0.55, counts, 0.2),
    body: [
      { kind: 'box', c: [0, 0, H / 2], s: [bw, bh, H], color: COL.black },
      { kind: 'cyl', c: [-bw / 2 + 0.35, bh / 2 - 0.35, H + 0.01], s: [0.12, 0.12, 0.02], axis: 'z', color: COL.white },
    ],
    verify: true,
    // fine-pitch leadless parts need room for escape routing / vias around the body
    courtyardMargin: 1.5,
    // nothing but the part's own fan-out under a sensor body (noise, stress, solder voids)
    routeKeepout: [{ x: 0, y: 0, w: bw - 1.2, h: bh - 1.2 }],
    viaKeepout: [{ x: 0, y: 0, w: bw + 0.3, h: bh + 0.3 }],
    fanout: true,
  });

export const qfn = (pins: number, size: number, pitch: number): PackageDef => {
  const per = pins / 4;
  const pads = perimeterPads(size, size, pitch, 0.3, 0.8, [per, per, per, per], 0.3);
  pads.push({ num: String(pins + 1), x: 0, y: 0, w: size * 0.6, h: size * 0.6, shape: 'rect' });
  return finish({
    id: `QFN-${pins}-${size}x${size}`,
    family: 'qfn',
    description: `QFN-${pins} ${size}×${size} mm（中央に放熱パッド）`,
    standard: 'JEDEC MO-220, IPC-7351 nominal',
    pads,
    body: [
      { kind: 'box', c: [0, 0, 0.45], s: [size, size, 0.9], color: COL.black },
      { kind: 'cyl', c: [-size / 2 + 0.6, size / 2 - 0.6, 0.91], s: [0.2, 0.2, 0.02], axis: 'z', color: COL.white },
    ],
  });
};

// ------------------------------------------------------------------ modules
/** ESP32-S3-WROOM-1 (18 x 25.5 mm). Antenna end at +y. Pins: left 1-14 (top->bottom), bottom 15-26 (left->right), right 27-40 (bottom->top), 41 = EPAD. */
export const esp32s3Wroom1 = (): PackageDef => {
  const W = 18, H = 25.5, pitch = 1.27;
  const pads: Pad[] = [];
  const y14 = -H / 2 + 2.0;
  const y1 = y14 + 13 * pitch;
  for (let i = 0; i < 14; i++) pads.push({ num: String(i + 1), x: -W / 2 + 0.6, y: y1 - i * pitch, w: 1.5, h: 0.9, shape: 'rect' });
  for (let i = 0; i < 12; i++) pads.push({ num: String(15 + i), x: (i - 5.5) * pitch, y: -H / 2 + 0.6, w: 0.9, h: 1.5, shape: 'rect' });
  for (let i = 0; i < 14; i++) pads.push({ num: String(27 + i), x: W / 2 - 0.6, y: y14 + i * pitch, w: 1.5, h: 0.9, shape: 'rect' });
  pads.push({ num: '41', x: -1.5, y: -3.0, w: 3.7, h: 3.7, shape: 'rect' });
  const antennaTop = H / 2;
  const antennaLen = H / 2 - (y1 + 0.9);
  return finish({
    id: 'ESP32-S3-WROOM-1',
    family: 'module',
    description: 'ESP32-S3-WROOM-1 無線マイコンモジュール（18×25.5 mm、上端がアンテナ）',
    standard: 'Espressif ESP32-S3-WROOM-1 データシート推奨ランド（近似）',
    pads,
    body: [
      { kind: 'box', c: [0, 0, 0.4], s: [W, H, 0.8], color: COL.pcbModule },
      { kind: 'box', c: [0, -H / 2 + (H - antennaLen) / 2 + 0.5, 0.8 + 1.2], s: [W - 2.4, H - antennaLen - 2.0, 2.4], color: COL.shield, metal: true },
      { kind: 'box', c: [0, antennaTop - antennaLen / 2, 0.82], s: [W - 3, antennaLen - 1, 0.04], color: COL.gold, metal: true },
    ],
    keepout: [{ x: 0, y: antennaTop - antennaLen / 2, w: W, h: antennaLen }],
    overhang: { side: 'top', length: antennaLen },
    // no foreign copper under the module bottom (exposed pads / test points); pads remain reachable from outside
    routeKeepout: [{ x: 0, y: (-H / 2 + 2.2 + (y1 + 1.0)) / 2, w: W - 4.4, h: y1 + 1.0 - (-H / 2 + 2.2) }],
    verify: true,
  });
};

// ------------------------------------------------------------------ connectors / THT
export const pinHeader = (pins: number, rows = 1, pitch = 2.54): PackageDef => {
  const pads: Pad[] = [];
  const cols = pins / rows;
  for (let i = 0; i < pins; i++) {
    const c = rows === 1 ? i : Math.floor(i / 2);
    const r = rows === 1 ? 0 : i % 2;
    pads.push({ num: String(i + 1), x: (c - (cols - 1) / 2) * pitch, y: rows === 1 ? 0 : (0.5 - r) * pitch, w: 1.7, h: 1.7, shape: i === 0 ? 'rect' : 'circle', drill: 1.0 });
  }
  const body: BodyPrim[] = [{ kind: 'box', c: [0, 0, 1.25], s: [cols * pitch, rows * pitch, 2.5], color: COL.black }];
  for (const p of pads) body.push({ kind: 'box', c: [p.x, p.y, 2.5 + 3], s: [0.64, 0.64, 6], color: COL.gold, metal: true });
  return finish({ id: `PinHeader-${rows}x${cols}-2.54`, family: 'header', description: `ピンヘッダ ${rows}×${cols} 2.54 mm`, standard: '2.54 mm (0.1 in) ピッチ汎用', pads, body });
};

export const jstSh = (pins: number): PackageDef => {
  const pitch = 1.0;
  const pads: Pad[] = [];
  for (let i = 0; i < pins; i++) pads.push({ num: String(i + 1), x: ((pins - 1) / 2 - i) * -pitch, y: 1.2, w: 0.6, h: 1.55, shape: 'roundrect' });
  const mx = (pins - 1) / 2 + 1.3;
  pads.push({ num: 'MP1', x: -mx, y: -1.6, w: 1.2, h: 1.8, shape: 'roundrect' });
  pads.push({ num: 'MP2', x: mx, y: -1.6, w: 1.2, h: 1.8, shape: 'roundrect' });
  const L = pins + 3;
  return finish({
    id: `JST-SH-${pins}-SMD`,
    family: 'connector',
    description: `JST SH ${pins} ピン 1.0 mm トップ（SMD）`,
    standard: 'JST SM**B-SRSS-TB 推奨ランド（近似）',
    pads,
    body: [
      { kind: 'box', c: [0, -0.9, 1.45], s: [L, 4.25, 2.9], color: COL.beige },
      { kind: 'box', c: [0, -0.9, 2.2], s: [L - 1.6, 3.0, 1.6], color: 0xcbbf9f },
    ],
    verify: true,
  });
};

export const jstPhTht = (pins: number): PackageDef => {
  const pitch = 2.0;
  const pads: Pad[] = [];
  for (let i = 0; i < pins; i++) pads.push({ num: String(i + 1), x: (i - (pins - 1) / 2) * pitch, y: 0, w: 1.2, h: 1.75, shape: i === 0 ? 'rect' : 'oval', drill: 0.75 });
  return finish({
    id: `JST-PH-${pins}-THT`,
    family: 'connector',
    description: `JST PH ${pins} ピン 2.0 mm トップ（THT）`,
    standard: 'JST B*B-PH-K-S',
    pads,
    body: [{ kind: 'box', c: [0, 0.9, 3.0], s: [pins * pitch + 1.9, 4.5, 6.0], color: COL.white }],
  });
};

export const tact3x4 = (): PackageDef =>
  finish({
    id: 'Tact-3x4-SMD',
    family: 'switch',
    description: 'タクトスイッチ 3×4 mm（SMD、2 端子）',
    standard: 'TS-1187A 系（近似）',
    pads: [
      { num: '1', x: -2.1, y: 0, w: 1.0, h: 1.4, shape: 'roundrect' },
      { num: '2', x: 2.1, y: 0, w: 1.0, h: 1.4, shape: 'roundrect' },
    ],
    body: [
      { kind: 'box', c: [0, 0, 0.75], s: [4.0, 3.0, 1.5], color: COL.metal, metal: true },
      { kind: 'cyl', c: [0, 0, 1.9], s: [0.8, 0.8, 0.8], axis: 'z', color: COL.black },
    ],
    verify: true,
  });

export const thtPads = (id: string, desc: string, pitch: number, padD: number, drill: number): PackageDef =>
  finish({
    id,
    family: 'pad',
    description: desc,
    standard: '配線直付け用スルーホール',
    pads: [
      { num: '1', x: -pitch / 2, y: 0, w: padD, h: padD, shape: 'rect', drill },
      { num: '2', x: pitch / 2, y: 0, w: padD, h: padD, shape: 'circle', drill },
    ],
    body: [],
  });

export const testPads = (pins: number, pitch: number): PackageDef =>
  finish({
    id: `TestPad-1x${pins}-${pitch}`,
    family: 'pad',
    description: `テストパッド 1×${pins}（${pitch} mm ピッチ、ポゴピン治具用）`,
    standard: 'SMD 円形パッド φ0.9 mm',
    pads: Array.from({ length: pins }, (_, i) => ({ num: String(i + 1), x: (i - (pins - 1) / 2) * pitch, y: 0, w: 0.9, h: 0.9, shape: (i === 0 ? 'rect' : 'circle') as PadShape })),
    body: [],
  });

export const mountHole = (drill: number): PackageDef =>
  finish({
    id: `MountHole-M${Math.round(drill - 0.2)}`,
    family: 'mechanical',
    description: `取付穴 φ${drill} mm（ノンプレーテッド）`,
    standard: 'ISO 273 medium（M2 → 2.2 mm）',
    pads: [{ num: '', x: 0, y: 0, w: drill, h: drill, shape: 'circle', drill, npth: true }],
    body: [],
    courtyardMargin: 1.0,
  });

// ------------------------------------------------------------------ archive-only THT discretes
export const axialResistor = (L = 6.3, D = 2.5, pitch = 10.16): PackageDef => {
  const body: BodyPrim[] = [{ kind: 'cyl', c: [0, 0, D / 2 + 0.5], s: [D / 2, D / 2, L], axis: 'x', color: COL.beige }];
  [-1.8, -0.9, 0, 1.4].forEach((x, i) => body.push({ kind: 'cyl', c: [x, 0, D / 2 + 0.5], s: [D / 2 + 0.02, D / 2 + 0.02, 0.4], axis: 'x', color: [COL.brown, 0x111111, 0xd32f2f, COL.gold][i] }));
  body.push({ kind: 'cyl', c: [0, 0, D / 2 + 0.5], s: [0.3, 0.3, pitch], axis: 'x', color: COL.metal, metal: true });
  return finish({
    id: `Axial-R-${pitch}`,
    family: 'tht-discrete',
    description: `アキシャル抵抗（1/4 W、本体 ${L}×φ${D} mm、足ピッチ ${pitch} mm）`,
    standard: 'IEC 60062 カラーコード / 0.4 in ピッチ',
    pads: [
      { num: '1', x: -pitch / 2, y: 0, w: 1.6, h: 1.6, shape: 'circle', drill: 0.8 },
      { num: '2', x: pitch / 2, y: 0, w: 1.6, h: 1.6, shape: 'circle', drill: 0.8 },
    ],
    body,
  });
};

export const do41 = (): PackageDef => ({
  ...axialResistor(5.2, 2.7, 10.16),
  id: 'DO-41',
  description: 'DO-41 アキシャルダイオード（1N4001/1N5819 等）',
  standard: 'JEDEC DO-41',
  body: [
    { kind: 'cyl', c: [0, 0, 1.85], s: [1.35, 1.35, 5.2], axis: 'x', color: COL.black },
    { kind: 'cyl', c: [-1.9, 0, 1.85], s: [1.37, 1.37, 0.6], axis: 'x', color: COL.white },
    { kind: 'cyl', c: [0, 0, 1.85], s: [0.4, 0.4, 10.16], axis: 'x', color: COL.metal, metal: true },
  ],
});

export const radialElectrolytic = (D = 5, H = 11, pitch = 2.0): PackageDef =>
  finish({
    id: `CP-Radial-D${D}-H${H}`,
    family: 'tht-discrete',
    description: `アルミ電解コンデンサ φ${D}×${H} mm（リード間 ${pitch} mm）`,
    standard: 'EIAJ ラジアルリード',
    pads: [
      { num: '1', x: -pitch / 2, y: 0, w: 1.6, h: 1.6, shape: 'rect', drill: 0.8 },
      { num: '2', x: pitch / 2, y: 0, w: 1.6, h: 1.6, shape: 'circle', drill: 0.8 },
    ],
    body: [
      { kind: 'cyl', c: [0, 0, H / 2 + 0.3], s: [D / 2, D / 2, H], axis: 'z', color: COL.electrolytic },
      { kind: 'box', c: [D / 2 - 0.4, 0, H / 2 + 0.3], s: [0.5, D * 0.5, H * 0.95], color: 0xbfbfbf },
      { kind: 'cyl', c: [0, 0, H + 0.31], s: [D / 2 - 0.2, D / 2 - 0.2, 0.02], axis: 'z', color: COL.metal, metal: true },
    ],
  });

export const ceramicDisc = (D = 5, pitch = 5.08): PackageDef =>
  finish({
    id: `C-Disc-D${D}`,
    family: 'tht-discrete',
    description: `セラミックコンデンサ（円板型 φ${D} mm）`,
    standard: 'ラジアルリード 0.2 in',
    pads: [
      { num: '1', x: -pitch / 2, y: 0, w: 1.6, h: 1.6, shape: 'circle', drill: 0.8 },
      { num: '2', x: pitch / 2, y: 0, w: 1.6, h: 1.6, shape: 'circle', drill: 0.8 },
    ],
    body: [{ kind: 'cyl', c: [0, 0, D / 2 + 2], s: [D / 2, D / 2, 2.5], axis: 'y', color: 0xe0a030 }],
  });

export const to92 = (): PackageDef =>
  finish({
    id: 'TO-92',
    family: 'tht-discrete',
    description: 'TO-92 小信号トランジスタ（2SC1815、2N7000 等）',
    standard: 'JEDEC TO-92',
    pads: [
      { num: '1', x: -1.27, y: 0, w: 1.3, h: 1.3, shape: 'rect', drill: 0.75 },
      { num: '2', x: 0, y: 0, w: 1.3, h: 1.3, shape: 'circle', drill: 0.75 },
      { num: '3', x: 1.27, y: 0, w: 1.3, h: 1.3, shape: 'circle', drill: 0.75 },
    ],
    body: [
      { kind: 'cyl', c: [0, 0.4, 5.5], s: [2.4, 2.4, 5.0], axis: 'z', color: COL.black },
      { kind: 'box', c: [0, -1.3, 5.5], s: [4.8, 1.6, 5.0], color: COL.black },
    ],
  });

export const to220 = (): PackageDef =>
  finish({
    id: 'TO-220-3',
    family: 'tht-discrete',
    description: 'TO-220 パワー素子（縦置き、MOSFET・レギュレータ等）',
    standard: 'JEDEC TO-220AB',
    pads: [
      { num: '1', x: -2.54, y: 0, w: 1.8, h: 1.8, shape: 'rect', drill: 1.1 },
      { num: '2', x: 0, y: 0, w: 1.8, h: 1.8, shape: 'circle', drill: 1.1 },
      { num: '3', x: 2.54, y: 0, w: 1.8, h: 1.8, shape: 'circle', drill: 1.1 },
    ],
    body: [
      { kind: 'box', c: [0, 0, 3 + 4.5], s: [10.0, 4.5, 9.0], color: COL.black },
      { kind: 'box', c: [0, 1.6, 3 + 9 + 3.2], s: [10.0, 1.3, 6.4], color: COL.metal, metal: true },
    ],
  });

export const sot223 = (): PackageDef => {
  const pads: Pad[] = [
    { num: '1', x: -2.3, y: -3.15, w: 0.95, h: 2.0, shape: 'roundrect' },
    { num: '2', x: 0, y: -3.15, w: 0.95, h: 2.0, shape: 'roundrect' },
    { num: '3', x: 2.3, y: -3.15, w: 0.95, h: 2.0, shape: 'roundrect' },
    { num: '4', x: 0, y: 3.15, w: 3.25, h: 2.0, shape: 'roundrect' },
  ];
  return finish({
    id: 'SOT-223',
    family: 'sot',
    description: 'SOT-223 電源用（LDO・MOSFET 等、タブ付き）',
    standard: 'JEDEC TO-261, IPC-7351 nominal',
    pads,
    body: [
      { kind: 'box', c: [0, 0, 0.9], s: [6.5, 3.5, 1.6], color: COL.black },
      { kind: 'box', c: [0, 3.0, 0.1], s: [3.0, 1.2, 0.2], color: COL.metal, metal: true },
    ],
  });
};

export const dip = (pins: number): PackageDef => {
  const n = pins / 2;
  const pads: Pad[] = [];
  for (let i = 0; i < n; i++) pads.push({ num: String(i + 1), x: -3.81, y: ((n - 1) / 2 - i) * 2.54, w: 1.6, h: 1.6, shape: i === 0 ? 'rect' : 'oval', drill: 0.8 });
  for (let i = 0; i < n; i++) pads.push({ num: String(n + i + 1), x: 3.81, y: (i - (n - 1) / 2) * 2.54, w: 1.6, h: 1.6, shape: 'oval', drill: 0.8 });
  return finish({
    id: `DIP-${pins}`,
    family: 'dip',
    description: `DIP-${pins}（0.3 in 幅）`,
    standard: 'JEDEC MS-001',
    pads,
    body: [{ kind: 'box', c: [0, 0, 2.3], s: [6.35, n * 2.54 - 0.3, 3.3], color: COL.black }],
  });
};

export const led5mm = (): PackageDef =>
  finish({
    id: 'LED-5mm',
    family: 'tht-discrete',
    description: '砲弾型 LED φ5 mm',
    standard: 'T-1¾',
    pads: [
      { num: '1', x: -1.27, y: 0, w: 1.6, h: 1.6, shape: 'rect', drill: 0.9 },
      { num: '2', x: 1.27, y: 0, w: 1.6, h: 1.6, shape: 'circle', drill: 0.9 },
    ],
    body: [
      { kind: 'cyl', c: [0, 0, 4.5], s: [2.5, 2.5, 7.0], axis: 'z', color: COL.led },
      { kind: 'cyl', c: [0, 0, 1.3], s: [2.9, 2.9, 1.0], axis: 'z', color: COL.led },
    ],
  });

export const powerInductor = (size = 4): PackageDef =>
  finish({
    id: `L-Power-${size}x${size}`,
    family: 'chip',
    description: `SMD パワーインダクタ ${size}×${size} mm（DC/DC 用）`,
    standard: 'メーカー標準サイズ（近似）',
    pads: [
      { num: '1', x: -size / 2 + 0.6, y: 0, w: 1.4, h: size * 0.9, shape: 'rect' },
      { num: '2', x: size / 2 - 0.6, y: 0, w: 1.4, h: size * 0.9, shape: 'rect' },
    ],
    body: [{ kind: 'box', c: [0, 0, 1.0], s: [size, size, 2.0], color: 0x3a3a3a }],
  });

export const crystalHc49 = (): PackageDef =>
  finish({
    id: 'HC-49S',
    family: 'tht-discrete',
    description: '水晶振動子 HC-49/S',
    standard: 'HC-49/US',
    pads: [
      { num: '1', x: -2.44, y: 0, w: 1.5, h: 1.5, shape: 'circle', drill: 0.8 },
      { num: '2', x: 2.44, y: 0, w: 1.5, h: 1.5, shape: 'circle', drill: 0.8 },
    ],
    body: [{ kind: 'box', c: [0, 0, 1.75], s: [11.0, 4.6, 3.5], color: COL.metal, metal: true }],
  });

// ------------------------------------------------------------------ registry
export const PACKAGES: Record<string, () => PackageDef> = {
  R0402: () => chip('R', '0402'),
  R0603: () => chip('R', '0603'),
  R0805: () => chip('R', '0805'),
  R1206: () => chip('R', '1206'),
  C0402: () => chip('C', '0402'),
  C0603: () => chip('C', '0603'),
  C0805: () => chip('C', '0805'),
  C1206: () => chip('C', '1206'),
  C1210: () => chip('C', '1210'),
  L0603: () => chip('L', '0603'),
  L0805: () => chip('L', '0805'),
  LED0603: () => chip('LED', '0603', 0.75),
  LED0805: () => chip('LED', '0805', 0.8),
  'SOT-23': () => sot23(3),
  'SOT-23-5': () => sot23(5),
  'SOT-23-6': () => sot23(6),
  'SOD-123': sod123,
  'SOT-223': sot223,
  'SOIC-8': () => soic(8),
  'SOIC-14': () => soic(14),
  'QFN-32-5x5': () => qfn(32, 5, 0.5),
  'LGA-14-2.5x3': () => lga('LGA-14-2.5x3', 2.5, 3.0, 0.91, [4, 3, 4, 3], 0.5, 'LGA-14 2.5×3.0 mm（6 軸 IMU 系）'),
  'LGA-10-2x2': () => lga('LGA-10-2x2', 2.0, 2.0, 0.75, [3, 2, 3, 2], 0.5, 'LGA-10 2.0×2.0 mm（気圧センサ系）'),
  'ESP32-S3-WROOM-1': esp32s3Wroom1,
  'PinHeader-1x6-2.54': () => pinHeader(6),
  'TestPad-1x6-1.27': () => testPads(6, 1.27),
  'PinHeader-2x5-2.54': () => pinHeader(10, 2),
  'JST-SH-8-SMD': () => jstSh(8),
  'JST-SH-4-SMD': () => jstSh(4),
  'JST-PH-2-THT': () => jstPhTht(2),
  'Tact-3x4-SMD': tact3x4,
  'MotorPad-2': () => thtPads('MotorPad-2', 'モータ配線用スルーホール 2 極（φ1.0 mm）', 2.54, 1.8, 1.0),
  'BatteryPad-2': () => thtPads('BatteryPad-2', '電池リード直付けパッド 2 極（φ1.3 mm、20 AWG）', 3.5, 2.6, 1.3),
  'MountHole-M2': () => mountHole(2.2),
  'MountHole-M3': () => mountHole(3.2),
  'Axial-R-10.16': () => axialResistor(),
  'DO-41': do41,
  'CP-Radial-D5-H11': () => radialElectrolytic(),
  'CP-Radial-D8-H12': () => radialElectrolytic(8, 12, 3.5),
  'C-Disc-D5': () => ceramicDisc(),
  'TO-92': to92,
  'TO-220-3': to220,
  'DIP-8': () => dip(8),
  'DIP-16': () => dip(16),
  'LED-5mm': led5mm,
  'L-Power-4x4': () => powerInductor(4),
  'HC-49S': crystalHc49,
};

export const getPackage = (id: string): PackageDef => {
  const f = PACKAGES[id];
  if (!f) throw new Error(`Unknown package ${id}`);
  return f();
};
