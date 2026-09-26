/**
 * Breadboard test-bench layout (830 tie-point board) for the Class A flight controller,
 * built from generic modules/THT parts, with automatic electrical verification.
 */

export interface BbPart {
  ref: string;
  label: string;
  kind: 'module' | 'resistor' | 'diode' | 'mosfet' | 'cap' | 'terminal';
  /** Pin holes: [half ('top'|'bot'), column (1..63), row (a..j index 0..9)] */
  pins: Array<{ name: string; net: string; col: number; row: number }>;
  color: string;
}

export interface BbWire {
  net: string;
  from: { col: number; row: number } | { rail: RailId; col: number } | { dev: string };
  to: { col: number; row: number } | { rail: RailId; col: number };
}

export type RailId = 'T+' | 'T-' | 'B+' | 'B-';

export interface BreadboardLayout {
  parts: BbPart[];
  wires: BbWire[];
  rails: Record<RailId, string>;
  devPins: Array<{ name: string; net: string }>;
  checks: Array<{ label: string; pass: boolean; detail: string }>;
  pass: boolean;
  bom: Array<{ item: string; qty: number; note: string }>;
}

const COLS = 63;
const ROWS = 'abcdefghij';
/** Row indices: a-e = 0..4 (top half), f-j = 5..9 (bottom half). */
const halfOf = (row: number): 'top' | 'bot' => (row < 5 ? 'top' : 'bot');

export const buildBreadboard = (rotorCount: number): BreadboardLayout => {
  const parts: BbPart[] = [];
  const rails: Record<RailId, string> = { 'T+': '3V3', 'T-': 'GND', 'B+': 'VBAT', 'B-': 'GND' };
  let col = 2;
  // --- sensor breakouts on the top half (pins in row a, bodies above the board) ---
  const module = (ref: string, label: string, pins: Array<[string, string]>, color: string): void => {
    parts.push({ ref, label, kind: 'module', pins: pins.map(([name, net], i) => ({ name, net, col: col + i, row: 0 })), color });
    col += pins.length + 2;
  };
  module('M1', 'IMU ブレイクアウト（ICM-42688-P）', [['VCC', '3V3'], ['GND', 'GND'], ['SCK', 'SPI_SCK'], ['SDI', 'SPI_MOSI'], ['SDO', 'SPI_MISO'], ['CS', 'IMU_CS'], ['INT', 'IMU_INT']], '#2e6bd6');
  module('M2', '気圧センサ ブレイクアウト（BMP390）', [['VCC', '3V3'], ['GND', 'GND'], ['SCL', 'I2C_SCL'], ['SDA', 'I2C_SDA']], '#6a1b9a');
  module('M3', 'フロー＋ToF モジュール', [['3V3', '3V3'], ['GND', 'GND'], ['SCK', 'SPI_SCK'], ['MOSI', 'SPI_MOSI'], ['MISO', 'SPI_MISO'], ['CS', 'FLOW_CS'], ['SDA', 'I2C_SDA'], ['SCL', 'I2C_SCL']], '#1b5e20');
  // I2C pull-ups (top half, rail 3V3 -> signal strip)
  const pullCol = col;
  parts.push({ ref: 'R3', label: '4.7k', kind: 'resistor', pins: [{ name: '1', net: '3V3', col: pullCol, row: 2 }, { name: '2', net: 'I2C_SDA', col: pullCol + 3, row: 2 }], color: '#e8dcc0' });
  parts.push({ ref: 'R4', label: '4.7k', kind: 'resistor', pins: [{ name: '1', net: '3V3', col: pullCol + 5, row: 2 }, { name: '2', net: 'I2C_SCL', col: pullCol + 8, row: 2 }], color: '#e8dcc0' });

  // --- motor drivers on the bottom half ---
  let bc = 2;
  for (let i = 0; i < rotorCount; i++) {
    const g = `GATE${i + 1}`, pwm = `PWM${i + 1}`, m = `MOT${i + 1}-`;
    const q = bc + 3;
    parts.push({ ref: `R${5 + 2 * i}`, label: '47Ω', kind: 'resistor', pins: [{ name: '1', net: pwm, col: bc, row: 6 }, { name: '2', net: g, col: q, row: 6 }], color: '#e8dcc0' });
    parts.push({ ref: `Q${i + 1}`, label: 'AO3400A（SOT-23→DIP 変換）', kind: 'mosfet', pins: [{ name: 'G', net: g, col: q, row: 5 }, { name: 'S', net: 'GND', col: q + 1, row: 5 }, { name: 'D', net: m, col: q + 2, row: 5 }], color: '#222222' });
    parts.push({ ref: `R${6 + 2 * i}`, label: '10k', kind: 'resistor', pins: [{ name: '1', net: g, col: q, row: 8 }, { name: '2', net: 'GND', col: q + 1, row: 8 }], color: '#e8dcc0' });
    parts.push({ ref: `D${i + 1}`, label: '1N5819', kind: 'diode', pins: [{ name: 'K', net: 'VBAT', col: q + 5, row: 7 }, { name: 'A', net: m, col: q + 2, row: 7 }], color: '#111111' });
    parts.push({ ref: `J${3 + i}`, label: `M${i + 1}`, kind: 'terminal', pins: [{ name: '+', net: 'VBAT', col: q + 5, row: 9 }, { name: '-', net: m, col: q + 2, row: 9 }], color: '#1565c0' });
    bc = q + 8;
  }
  // battery monitor + bulk cap
  parts.push({ ref: 'R13', label: '100k', kind: 'resistor', pins: [{ name: '1', net: 'VBAT', col: bc, row: 6 }, { name: '2', net: 'VBAT_SENSE', col: bc + 3, row: 6 }], color: '#e8dcc0' });
  parts.push({ ref: 'R14', label: '100k', kind: 'resistor', pins: [{ name: '1', net: 'VBAT_SENSE', col: bc + 3, row: 8 }, { name: '2', net: 'GND', col: bc + 6, row: 8 }], color: '#e8dcc0' });
  parts.push({ ref: 'C11', label: '100nF', kind: 'cap', pins: [{ name: '1', net: 'VBAT_SENSE', col: bc + 3, row: 9 }, { name: '2', net: 'GND', col: bc + 5, row: 9 }], color: '#e0a030' });
  parts.push({ ref: 'C1', label: '470µF 6.3V', kind: 'cap', pins: [{ name: '+', net: 'VBAT', col: bc + 9, row: 6 }, { name: '-', net: 'GND', col: bc + 10, row: 6 }], color: '#1d3d8f' });
  parts.push({ ref: 'J1', label: '電池 1S（JST-PH/BT2.0）', kind: 'terminal', pins: [{ name: '+', net: 'VBAT', col: bc + 13, row: 6 }, { name: '-', net: 'GND', col: bc + 14, row: 6 }], color: '#c62828' });

  // --- DevKitC pins (off-board, jumpers) ---
  const devPins: Array<{ name: string; net: string }> = [
    { name: '3V3', net: '3V3' }, { name: 'GND', net: 'GND' },
    ...Array.from({ length: rotorCount }, (_, i) => ({ name: ['IO4', 'IO5', 'IO6', 'IO7', 'IO15', 'IO16'][i], net: `PWM${i + 1}` })),
    { name: 'IO12', net: 'SPI_SCK' }, { name: 'IO11', net: 'SPI_MOSI' }, { name: 'IO13', net: 'SPI_MISO' }, { name: 'IO10', net: 'IMU_CS' },
    { name: 'IO9', net: 'IMU_INT' }, { name: 'IO14', net: 'FLOW_CS' }, { name: 'IO8', net: 'I2C_SDA' }, { name: 'IO21', net: 'I2C_SCL' }, { name: 'IO1', net: 'VBAT_SENSE' },
  ];

  // --- strip nets & wiring ---
  const strip = new Map<string, string>(); // `${half}:${col}` -> net
  const occupied = new Set<string>(); // `${col}:${row}`
  const checks: BreadboardLayout['checks'] = [];
  let conflicts = 0, holeClash = 0, outOfBoard = 0;
  for (const p of parts)
    for (const pin of p.pins) {
      if (pin.col < 1 || pin.col > COLS) outOfBoard++;
      const hk = `${pin.col}:${pin.row}`;
      if (occupied.has(hk)) holeClash++;
      occupied.add(hk);
      const sk = `${halfOf(pin.row)}:${pin.col}`;
      const cur = strip.get(sk);
      if (cur && cur !== pin.net) conflicts++;
      strip.set(sk, pin.net);
    }
  const freeHole = (half: 'top' | 'bot', c: number): number | null => {
    const rows = half === 'top' ? [4, 3, 2, 1, 0] : [5, 6, 7, 8, 9];
    for (const r of rows) if (!occupied.has(`${c}:${r}`)) return r;
    return null;
  };
  const wires: BbWire[] = [];
  const netsAll = new Set([...strip.values(), ...devPins.map((d) => d.net)]);
  for (const net of netsAll) {
    const strips = [...strip.entries()].filter(([, n]) => n === net).map(([k]) => ({ half: k.split(':')[0] as 'top' | 'bot', col: Number(k.split(':')[1]) }));
    const railIds = (Object.keys(rails) as RailId[]).filter((r) => rails[r] === net);
    const take = (s: { half: 'top' | 'bot'; col: number }): { col: number; row: number } | null => {
      const r = freeHole(s.half, s.col);
      if (r === null) return null;
      occupied.add(`${s.col}:${r}`);
      return { col: s.col, row: r };
    };
    if (railIds.length) {
      // every strip of a rail net gets a jumper to the nearest rail of its half
      for (const s of strips) {
        const rail = railIds.find((r) => (s.half === 'top' ? r.startsWith('T') : r.startsWith('B'))) ?? railIds[0];
        const h = take(s);
        if (h) wires.push({ net, from: h, to: { rail, col: s.col } });
      }
      // connect rails of the same net across halves
      if (railIds.length > 1) wires.push({ net, from: { rail: railIds[0], col: 1 }, to: { rail: railIds[1], col: 1 } });
    } else {
      // chain strips in column order
      const sorted = strips.sort((a, b) => a.col - b.col || (a.half === b.half ? 0 : a.half === 'top' ? -1 : 1));
      for (let i = 1; i < sorted.length; i++) {
        const a = take(sorted[i - 1]), b = take(sorted[i]);
        if (a && b) wires.push({ net, from: a, to: b });
      }
    }
    // dev-board jumper lands on the first strip (or rail)
    if (devPins.some((d) => d.net === net)) {
      if (railIds.length) wires.push({ net, from: { dev: net }, to: { rail: railIds[0], col: 1 } });
      else if (strips.length) {
        const h = take(strips[0]);
        if (h) wires.push({ net, from: { dev: net }, to: h });
      }
    }
  }
  // --- verification: union-find over strips / rails / dev pins ---
  const parent = new Map<string, string>();
  const find = (a: string): string => {
    if (!parent.has(a)) parent.set(a, a);
    const p = parent.get(a)!;
    if (p === a) return a;
    const r = find(p);
    parent.set(a, r);
    return r;
  };
  const union = (a: string, b: string): void => {
    parent.set(find(a), find(b));
  };
  const nodeOf = (e: BbWire['from'] | BbWire['to']): string =>
    'dev' in e ? `dev:${e.dev}` : 'rail' in e ? `rail:${e.rail}` : `${halfOf(e.row)}:${e.col}`;
  for (const w of wires) union(nodeOf(w.from), nodeOf(w.to));
  let broken = 0;
  const brokenNets: string[] = [];
  for (const net of netsAll) {
    const nodes = [...[...strip.entries()].filter(([, n]) => n === net).map(([k]) => k), ...(devPins.some((d) => d.net === net) ? [`dev:${net}`] : [])];
    const roots = new Set(nodes.map(find));
    if (roots.size > 1) { broken++; brokenNets.push(net); }
  }
  // wires must not short different nets through strips
  let wireShort = 0;
  for (const w of wires) for (const e of [w.from, w.to]) if (!('dev' in e) && !('rail' in e) && strip.get(`${halfOf(e.row)}:${e.col}`) !== w.net) wireShort++;
  checks.push({ label: '同じ列（5 穴）に異なるネットがない', pass: conflicts === 0, detail: `衝突 ${conflicts}` });
  checks.push({ label: '同じ穴に 2 本以上挿さない', pass: holeClash === 0, detail: `重複 ${holeClash}` });
  checks.push({ label: 'ボード範囲内（63 列）', pass: outOfBoard === 0, detail: `範囲外 ${outOfBoard}` });
  checks.push({ label: '全ネットが導通', pass: broken === 0, detail: broken ? `未導通: ${brokenNets.join(', ')}` : `ネット ${netsAll.size} 本すべて導通` });
  checks.push({ label: 'ジャンパ線が他ネットの列に刺さっていない', pass: wireShort === 0, detail: `誤接続 ${wireShort}` });
  const bom = [
    { item: 'ブレッドボード 830 穴', qty: 1, note: '電源レール付き' },
    { item: 'ESP32-S3-DevKitC-1', qty: 1, note: 'ボード外に置きジャンパで接続（3V3 は DevKit の LDO から供給）' },
    { item: 'IMU ブレイクアウト（ICM-42688-P）', qty: 1, note: '他社互換品可' },
    { item: 'BMP390 ブレイクアウト', qty: 1, note: 'DPS310 等でも可（ピン配置を確認）' },
    { item: 'PMW3901＋VL53L1X モジュール', qty: 1, note: '' },
    { item: 'AO3400A ＋ SOT-23→DIP 変換基板', qty: rotorCount, note: 'はんだ付けが必要' },
    { item: '1N5819（DO-41）', qty: rotorCount, note: '還流ダイオード' },
    { item: '抵抗 47Ω / 10k / 4.7k / 100k（1/4 W）', qty: rotorCount * 2 + 4, note: '' },
    { item: '電解コンデンサ 470 µF 6.3 V', qty: 1, note: 'ベンチ電源のノイズ対策' },
    { item: 'コアレスモータ 8520', qty: rotorCount, note: 'プロペラは外して試験（安全のため）' },
    { item: 'ジャンパ線', qty: wires.length, note: '' },
  ];
  return { parts, wires, rails, devPins, checks, pass: checks.every((c) => c.pass), bom };
};

const NET_COLORS: Record<string, string> = { GND: '#111111', '3V3': '#d32f2f', VBAT: '#ff6f00' };
const netColor = (net: string): string => NET_COLORS[net] ?? (net.startsWith('PWM') || net.startsWith('GATE') ? '#2e7d32' : net.startsWith('MOT') ? '#6d4c41' : net.startsWith('SPI') || net.includes('CS') ? '#1565c0' : net.startsWith('I2C') ? '#8e24aa' : '#00838f');

export const renderBreadboardSvg = (b: BreadboardLayout): string => {
  const p = 16; // px per 2.54 mm
  const ox = 170, oy = 190;
  const hx = (c: number): number => ox + (c - 1) * p;
  const hy = (r: number): number => oy + (r < 5 ? r * p : (r + 2) * p);
  const railY: Record<RailId, number> = { 'T+': oy - 3 * p, 'T-': oy - 2 * p, 'B+': oy + 13 * p, 'B-': oy + 14 * p };
  const W = ox + COLS * p + 40, H = oy + 16 * p + 60;
  const s: string[] = [];
  s.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="#f9f9f7"/>`);
  s.push(`<rect x="${ox - p}" y="${oy - 4 * p}" width="${(COLS + 1) * p}" height="${19.5 * p}" rx="8" fill="#f3f1ea" stroke="#c3c2b7"/>`);
  for (const [id, y] of Object.entries(railY) as Array<[RailId, number]>) {
    s.push(`<line x1="${ox - p * 0.5}" x2="${ox + COLS * p - p * 0.5}" y1="${y}" y2="${y}" stroke="${id.endsWith('+') ? '#d32f2f' : '#1565c0'}" stroke-width="1" opacity="0.4"/>`);
    s.push(`<text x="${ox - p * 1.3}" y="${y + 4}" font-size="10" text-anchor="end" fill="#52514e">${id.endsWith('+') ? '+' : '−'} ${b.rails[id]}</text>`);
    for (let c = 1; c <= COLS; c++) if (c % 6 !== 0) s.push(`<rect x="${hx(c) - 2}" y="${y - 2}" width="4" height="4" fill="#9e9d95"/>`);
  }
  for (let c = 1; c <= COLS; c++) {
    for (let r = 0; r < 10; r++) s.push(`<rect x="${hx(c) - 2}" y="${hy(r) - 2}" width="4" height="4" fill="#9e9d95"/>`);
    if (c % 5 === 0 || c === 1) s.push(`<text x="${hx(c)}" y="${oy - 5 * p + 6}" font-size="8" text-anchor="middle" fill="#898781">${c}</text>`);
  }
  for (let r = 0; r < 10; r++) s.push(`<text x="${ox - p * 1.6}" y="${hy(r) + 3}" font-size="8" fill="#898781">${ROWS[r]}</text>`);
  s.push(`<rect x="${ox - p}" y="${oy + 4.4 * p}" width="${(COLS + 1) * p}" height="${1.2 * p}" fill="#e6e3d8"/>`);
  // wires
  const pt = (e: BbWire['from'] | BbWire['to']): [number, number] => {
    if ('dev' in e) {
      const i = b.devPins.findIndex((d) => d.net === e.dev);
      return [110, 70 + i * 16];
    }
    if ('rail' in e) return [hx(e.col), railY[e.rail]];
    return [hx(e.col), hy(e.row)];
  };
  for (const w of b.wires) {
    const [x1, y1] = pt(w.from), [x2, y2] = pt(w.to);
    const my = Math.min(y1, y2) - 10 - Math.abs(x2 - x1) * 0.08;
    s.push(`<path d="M${x1},${y1} Q${(x1 + x2) / 2},${'dev' in w.from ? (y1 + y2) / 2 : my} ${x2},${y2}" fill="none" stroke="${netColor(w.net)}" stroke-width="2.2" stroke-linecap="round" opacity="0.85"><title>${w.net}</title></path>`);
  }
  // parts
  for (const part of b.parts) {
    const cols = part.pins.map((q) => q.col), rows = part.pins.map((q) => q.row);
    const x0 = hx(Math.min(...cols)) - 5, x1 = hx(Math.max(...cols)) + 5;
    if (part.kind === 'module') {
      // breakout stands upright on its header: body drawn above the rails, leads down to row a
      const top = railY['T+'] - 70;
      s.push(`<rect x="${x0 - 4}" y="${top}" width="${x1 - x0 + 8}" height="56" rx="4" fill="${part.color}" opacity="0.92"/>`);
      s.push(`<text x="${(x0 + x1) / 2}" y="${top + 14}" font-size="10" text-anchor="middle" fill="#fff" font-weight="600">${part.ref}</text>`);
      for (const q of part.pins) s.push(`<text x="${hx(q.col)}" y="${top + 50}" font-size="7" text-anchor="middle" fill="#fff" transform="rotate(-70 ${hx(q.col)} ${top + 50})">${q.name}</text><line x1="${hx(q.col)}" x2="${hx(q.col)}" y1="${top + 56}" y2="${hy(0)}" stroke="#555" stroke-width="1.5"/>`);
      s.push(`<text x="${(x0 + x1) / 2}" y="${top - 6}" font-size="9" text-anchor="middle" fill="#0b0b0b">${part.label}</text>`);
    } else {
      const ys = rows.map(hy);
      const cx = (x0 + x1) / 2, cy = ys.reduce((a, c) => a + c, 0) / ys.length;
      if (part.pins.length === 2 && (part.kind === 'resistor' || part.kind === 'diode' || part.kind === 'cap')) {
        const [a, c] = part.pins;
        s.push(`<line x1="${hx(a.col)}" y1="${hy(a.row)}" x2="${hx(c.col)}" y2="${hy(c.row)}" stroke="#777" stroke-width="1.5"/>`);
        s.push(`<rect x="${cx - 12}" y="${cy - 5}" width="24" height="10" rx="4" fill="${part.color}" stroke="#555"/>`);
      } else {
        s.push(`<rect x="${x0}" y="${Math.min(...ys) - 6}" width="${x1 - x0}" height="${Math.max(...ys) - Math.min(...ys) + 12}" rx="3" fill="${part.color}" opacity="0.85"/>`);
      }
      s.push(`<text x="${cx}" y="${Math.max(...ys) + 16}" font-size="8" text-anchor="middle" fill="#0b0b0b">${part.ref} ${part.label.length > 10 ? '' : part.label}</text>`);
    }
  }
  // dev board
  s.push(`<rect x="20" y="50" width="100" height="${b.devPins.length * 16 + 30}" rx="6" fill="#263238"/>`);
  s.push(`<text x="70" y="44" font-size="10" text-anchor="middle" fill="#0b0b0b">ESP32-S3-DevKitC-1</text>`);
  b.devPins.forEach((d, i) => s.push(`<circle cx="110" cy="${70 + i * 16}" r="3" fill="#d4af37"/><text x="100" y="${73 + i * 16}" font-size="8" text-anchor="end" fill="#fff">${d.name}</text>`));
  // legend
  const legend: Array<[string, string]> = [['GND', '#111111'], ['3V3', '#d32f2f'], ['VBAT', '#ff6f00'], ['PWM/ゲート', '#2e7d32'], ['モータ', '#6d4c41'], ['SPI', '#1565c0'], ['I²C', '#8e24aa']];
  legend.forEach(([t, c], i) => s.push(`<line x1="${ox + i * 90}" x2="${ox + i * 90 + 20}" y1="${H - 20}" y2="${H - 20}" stroke="${c}" stroke-width="3"/><text x="${ox + i * 90 + 25}" y="${H - 16}" font-size="10" fill="#52514e">${t}</text>`));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="system-ui, 'Yu Gothic UI', sans-serif">${s.join('')}</svg>`;
};
