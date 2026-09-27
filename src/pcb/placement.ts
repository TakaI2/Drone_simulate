import type { Circuit, Component } from '../electrical/circuit';
import { getPackage } from '../parts3d/packages';
import type { PackageDef } from '../parts3d/packages';
import { courtyardRect, placePad, rectsOverlap, transformPoint } from './geometry';
import type { Board, DesignRules, PlacedPad, Placement, Rect, Track, Via, Zone } from './types';

export interface PlacementOptions {
  board: Board;
  rules: DesignRules;
  /** Rotor arm directions in the body/board frame (rad), index = motor number - 1. */
  rotorAngles: number[];
  /** Mounting-hole inset from the board corner [mm]. */
  holeInset?: number;
  /** Explicit mounting-hole positions (board coords); default = four corners. */
  holePositions?: Array<{ x: number; y: number }>;
  /** 'largest-first' places big parts before passives (small boards); default keeps the original order. */
  order?: 'default' | 'largest-first';
  /** Fixed placements (e.g. a connector at the cable-exit edge). */
  anchors?: Array<{ ref: string; x: number; y: number; rot: number }>;
  /** Grow fan-out parts' courtyards to cover their escape tracks and ground vias (exact extent). */
  fanoutAwareCourtyard?: boolean;
}

export interface PlacementResult {
  placements: Placement[];
  pads: PlacedPad[];
  zones: Zone[];
  vias: Via[];
  layerKeepouts: Array<{ layer: 'F' | 'B'; rect: Rect }>;
  /** Both-layer copper keep-outs (antenna). */
  keepouts: Rect[];
  /** Via keep-outs (under sensor bodies). */
  viaKeepouts: Rect[];
  /** Pre-routed fan-out tracks of fine-pitch parts. */
  fanoutTracks: Track[];
  /** Fan-out nets ordered centre-of-row first (outer pins would otherwise wall in the middle ones). */
  fanoutOrder: string[];
  failures: string[];
  log: string[];
}

/** Layout tuning constants. */
/** Fan-out geometry for fine-pitch pads [mm]. */
const FANOUT = {
  straight: 0.35,
  spread: 2.0,
  minDiagonal: 0.35,
} as const;

const PLACE = {
  window: 14,
  step: 0.25,
  gap: 0.3,
  edgeMargin: 0.3,
  nearWeight: 4,
  netWeight: 1,
  imuCenterWeight: 6,
  thermalCourtyard: 3.3,
  motorPadInset: 2.0,
} as const;

/** Nets ignored for attraction (they are everywhere / handled by planes). */
const GLOBAL_NETS = new Set(['GND', 'VBAT', '3V3']);

const withThermalCourtyard = (pkg: PackageDef): PackageDef => ({ ...pkg, courtyard: { w: Math.max(pkg.courtyard.w, PLACE.thermalCourtyard), h: pkg.courtyard.h } });

export const placeComponents = (circuit: Circuit, o: PlacementOptions): PlacementResult => {
  const { board, rules } = o;
  const log: string[] = [];
  const failures: string[] = [];
  const placements: Placement[] = [];
  const byRef = new Map<string, Component>(circuit.components.map((c) => [c.ref, c]));
  const netByName = new Map(circuit.nets.map((n) => [n.name, n]));
  const placed = new Map<string, Placement>();
  const boardRect: Rect = { x: -board.w / 2 + PLACE.edgeMargin, y: -board.h / 2 + PLACE.edgeMargin, w: board.w - 2 * PLACE.edgeMargin, h: board.h - 2 * PLACE.edgeMargin };
  const pkgOf = (c: Component): PackageDef => {
    const pkg = getPackage(c.part.package);
    if (o.fanoutAwareCourtyard && pkg.fanout) {
      // farthest fan-out end: pad edge + straight + diagonal spread + ground via + clearance
      let w = pkg.courtyard.w, h = pkg.courtyard.h;
      for (const p of pkg.pads) {
        const along = Math.abs(p.w > p.h ? p.y : p.x);
        const reach = FANOUT.straight + Math.max(FANOUT.minDiagonal, along * (FANOUT.spread - 1)) + rules.viaDiameter + rules.clearance;
        if (p.w > p.h) {
          w = Math.max(w, Math.abs(p.x) + p.w / 2 + reach);
          h = Math.max(h, along * FANOUT.spread + rules.viaDiameter);
        } else {
          h = Math.max(h, Math.abs(p.y) + p.h / 2 + reach);
          w = Math.max(w, along * FANOUT.spread + rules.viaDiameter);
        }
      }
      return { ...pkg, courtyard: { w, h } };
    }
    return c.thermalPins && c.part.category === 'mosfet' ? withThermalCourtyard(pkg) : pkg;
  };
  const fits = (pl: Placement, checkBoard = true): boolean => {
    const r = courtyardRect(pl);
    if (checkBoard) {
      if (r.x < boardRect.x || r.y < boardRect.y || r.x + r.w > boardRect.x + boardRect.w || r.y + r.h > boardRect.y + boardRect.h) return false;
    }
    for (const q of placed.values()) if (rectsOverlap(r, courtyardRect(q), PLACE.gap)) return false;
    return true;
  };
  const commit = (pl: Placement): void => {
    placed.set(pl.ref, pl);
    placements.push(pl);
  };
  const pinPos = (ref: string, num: string): { x: number; y: number } | null => {
    const pl = placed.get(ref);
    if (!pl) return null;
    const pad = pl.pkg.pads.find((p) => p.num === num);
    return pad ? transformPoint(pl, pad.x, pad.y) : null;
  };

  // ---------------- anchors ----------------
  const inset = o.holeInset ?? 2.4;
  const holes = circuit.components.filter((c) => c.part.category === 'mechanical');
  const holePos = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
  holes.forEach((c, i) => {
    const [sx, sy] = holePos[i % 4];
    const given = o.holePositions?.[i];
    commit({ ref: c.ref, pkg: pkgOf(c), x: given ? given.x : sx * (board.w / 2 - inset), y: given ? given.y : sy * (board.h / 2 - inset), rot: 0 });
  });

  for (const a of o.anchors ?? []) {
    const c = byRef.get(a.ref);
    if (c && !placed.has(a.ref)) commit({ ref: a.ref, pkg: pkgOf(c), x: a.x, y: a.y, rot: a.rot });
  }

  const mcu = circuit.components.find((c) => c.part.category === 'mcu');
  if (mcu) {
    const pkg = pkgOf(mcu);
    const ant = pkg.overhang?.length ?? 0;
    // rot 90: package +y (antenna) -> board -x (rear); antenna overhangs the rear edge
    const halfLen = pkg.courtyard.h - 0.25;
    let cx = -board.w / 2 + halfLen - ant;
    // keep the castellated pads inside the board edge clearance
    const minPadX = Math.min(...pkg.pads.map((p) => transformPoint({ ref: mcu.ref, pkg, x: cx, y: 0, rot: 90 }, p.x, p.y).x - p.h / 2));
    const need = -board.w / 2 + rules.edgeClearance + 0.2;
    if (minPadX < need) cx += need - minPadX;
    const pl: Placement = { ref: mcu.ref, pkg, x: cx, y: 0, rot: 90 };
    commit(pl);
    log.push(`${mcu.ref}: モジュールを後端に配置（アンテナ ${ant.toFixed(1)} mm を基板外へ張り出し）`);
  }

  const battery = circuit.components.find((c) => c.partId === 'BatteryPad');
  if (battery) commit({ ref: battery.ref, pkg: pkgOf(battery), x: board.w / 2 - 2.4, y: 0, rot: 90 });

  // motor pads: nearest free perimeter point to the arm ray
  const motorPads = circuit.components.filter((c) => c.partId === 'MotorPad');
  motorPads.forEach((c, i) => {
    const th = o.rotorAngles[i] ?? 0;
    const hw = board.w / 2 - PLACE.motorPadInset, hh = board.h / 2 - PLACE.motorPadInset;
    const t = Math.min(hw / Math.max(1e-9, Math.abs(Math.cos(th))), hh / Math.max(1e-9, Math.abs(Math.sin(th))));
    const ideal = { x: t * Math.cos(th), y: t * Math.sin(th) };
    const cands: Array<{ x: number; y: number; rot: number; d: number }> = [];
    for (let s = -hw; s <= hw; s += 0.25) {
      cands.push({ x: s, y: hh, rot: 0, d: 0 }, { x: s, y: -hh, rot: 0, d: 0 });
    }
    for (let s = -hh; s <= hh; s += 0.25) {
      cands.push({ x: hw, y: s, rot: 90, d: 0 }, { x: -hw, y: s, rot: 90, d: 0 });
    }
    for (const k of cands) k.d = Math.hypot(k.x - ideal.x, k.y - ideal.y);
    cands.sort((a, b) => a.d - b.d);
    const pkg = pkgOf(c);
    const hit = cands.find((k) => fits({ ref: c.ref, pkg, x: k.x, y: k.y, rot: k.rot }));
    if (hit) commit({ ref: c.ref, pkg, x: hit.x, y: hit.y, rot: hit.rot });
    else failures.push(`${c.ref}: モータパッドの配置場所がありません`);
  });

  // ---------------- greedy constructive placement ----------------
  const priority = (c: Component): number => {
    if (c.part.category === 'mosfet') return 0;
    if (c.group) return 1;
    if (c.part.category === 'imu') return 2;
    if (c.part.category === 'ldo' || c.part.category === 'dcdc' || c.part.category === 'baro') return 3;
    if (c.near) return 4;
    return 5;
  };
  const area = (c: Component): number => {
    const k = pkgOf(c).courtyard;
    return k.w * k.h;
  };
  const rest = circuit.components
    .filter((c) => !placed.has(c.ref))
    .sort((a, b) => (o.order === 'largest-first' ? area(b) - area(a) : 0) || priority(a) - priority(b));
  for (const c of rest) {
    const pkg = pkgOf(c);
    // attraction targets
    const targets: Array<{ x: number; y: number; w: number }> = [];
    if (c.near) {
      const n = placed.get(c.near);
      if (n) targets.push({ x: n.x, y: n.y, w: PLACE.nearWeight });
    }
    if (c.part.category === 'imu') targets.push({ x: 0, y: 0, w: PLACE.imuCenterWeight });
    for (const p of c.pins) {
      if (!p.net || GLOBAL_NETS.has(p.net)) continue;
      const net = netByName.get(p.net);
      for (const q of net?.pins ?? []) {
        if (q.ref === c.ref) continue;
        const pos = pinPos(q.ref, q.pin);
        if (pos) targets.push({ x: pos.x, y: pos.y, w: PLACE.netWeight });
      }
    }
    const tw = targets.reduce((s, t) => s + t.w, 0);
    const ideal = tw > 0 ? { x: targets.reduce((s, t) => s + t.x * t.w, 0) / tw, y: targets.reduce((s, t) => s + t.y * t.w, 0) / tw } : { x: 0, y: 0 };
    let best: { pl: Placement; cost: number } | null = null;
    for (let radius = PLACE.window; radius <= Math.max(board.w, board.h) * 1.5 && !best; radius *= 2) {
      for (let dx = -radius; dx <= radius; dx += PLACE.step) {
        for (let dy = -radius; dy <= radius; dy += PLACE.step) {
          const x = Math.round((ideal.x + dx) / PLACE.step) * PLACE.step;
          const y = Math.round((ideal.y + dy) / PLACE.step) * PLACE.step;
          for (const rot of [0, 90, 180, 270]) {
            const pl: Placement = { ref: c.ref, pkg, x, y, rot };
            // cost: pin-to-target distances
            let cost = 0;
            if (c.near) {
              const n = placed.get(c.near);
              if (n) cost += PLACE.nearWeight * Math.hypot(x - n.x, y - n.y);
            }
            if (c.part.category === 'imu') cost += PLACE.imuCenterWeight * Math.hypot(x, y);
            for (const p of c.pins) {
              if (!p.net || GLOBAL_NETS.has(p.net)) continue;
              const pad = pkg.pads.find((q) => q.num === p.num);
              if (!pad) continue;
              const pp = transformPoint(pl, pad.x, pad.y);
              const net = netByName.get(p.net);
              let dmin = Infinity;
              for (const q of net?.pins ?? []) {
                if (q.ref === c.ref) continue;
                const pos = pinPos(q.ref, q.pin);
                if (pos) dmin = Math.min(dmin, Math.hypot(pos.x - pp.x, pos.y - pp.y));
              }
              if (Number.isFinite(dmin)) cost += PLACE.netWeight * dmin;
            }
            cost += 0.01 * Math.hypot(dx, dy);
            if (best && cost >= best.cost) continue;
            if (!fits(pl)) continue;
            best = { pl, cost };
          }
        }
      }
    }
    if (best) commit(best.pl);
    else failures.push(`${c.ref}: 配置できる空きがありません`);
  }

  // ---------------- pads, thermal copper, via-in-pad ----------------
  const pads: PlacedPad[] = [];
  const zones: Zone[] = [];
  const vias: Via[] = [];
  const layerKeepouts: Array<{ layer: 'F' | 'B'; rect: Rect }> = [];
  const keepouts: Rect[] = [];
  const viaKeepouts: Rect[] = [];
  const fanoutTracks: Track[] = [];
  const fanoutRank = new Map<string, number>();
  const toRect = (pl: Placement, k: { x: number; y: number; w: number; h: number }): Rect => {
    const a = transformPoint(pl, k.x - k.w / 2, k.y - k.h / 2), b = transformPoint(pl, k.x + k.w / 2, k.y + k.h / 2);
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
  };
  for (const pl of placements) {
    const comp = byRef.get(pl.ref)!;
    for (const k of pl.pkg.viaKeepout ?? []) viaKeepouts.push(toRect(pl, k));
    if (pl.pkg.fanout) {
      // escape each connected pad straight out of its row, then diagonally away from the row center (pitch x spread)
      const bw = Math.max(...pl.pkg.pads.map((p) => Math.abs(p.x)));
      for (const p of pl.pkg.pads) {
        const pin = comp.pins.find((q) => q.num === p.num);
        if (!pin?.net) continue;
        const onX = Math.abs(Math.abs(p.x) - bw) < 1e-6 && p.w > p.h; // left/right rows (pads long in x)
        const nx = onX ? Math.sign(p.x) : 0, ny = onX ? 0 : Math.sign(p.y);
        const along = onX ? p.y : p.x;
        fanoutRank.set(pin.net, Math.min(fanoutRank.get(pin.net) ?? Infinity, Math.abs(along)));
        const half = (onX ? p.w : p.h) / 2;
        const sx = p.x + nx * (half + FANOUT.straight), sy = p.y + ny * (half + FANOUT.straight);
        const diag = Math.max(FANOUT.minDiagonal, Math.abs(along) * (FANOUT.spread - 1));
        const ex = sx + nx * diag + (onX ? 0 : Math.sign(along) * Math.abs(along) * (FANOUT.spread - 1));
        const ey = sy + ny * diag + (onX ? Math.sign(along) * Math.abs(along) * (FANOUT.spread - 1) : 0);
        const a = transformPoint(pl, p.x, p.y), b = transformPoint(pl, sx, sy), c = transformPoint(pl, ex, ey);
        const w = rules.trackWidth.signal;
        fanoutTracks.push({ net: pin.net, layer: 'F', x1: a.x, y1: a.y, x2: b.x, y2: b.y, width: w });
        fanoutTracks.push({ net: pin.net, layer: 'F', x1: b.x, y1: b.y, x2: c.x, y2: c.y, width: w });
        if (pin.net === 'GND') {
          const dx = c.x - b.x, dy = c.y - b.y, l = Math.hypot(dx, dy) || 1;
          const vx = c.x + (dx / l) * (rules.viaDiameter / 2), vy = c.y + (dy / l) * (rules.viaDiameter / 2);
          fanoutTracks.push({ net: pin.net, layer: 'F', x1: c.x, y1: c.y, x2: vx, y2: vy, width: w });
          vias.push({ net: pin.net, x: vx, y: vy, d: rules.viaDiameter, drill: rules.viaDrill, kind: 'gnd' });
        }
      }
    }
    for (const k of pl.pkg.keepout ?? []) {
      const a = transformPoint(pl, k.x - k.w / 2, k.y - k.h / 2), b = transformPoint(pl, k.x + k.w / 2, k.y + k.h / 2);
      keepouts.push({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) });
    }
    for (const k of pl.pkg.routeKeepout ?? []) {
      const a = transformPoint(pl, k.x - k.w / 2, k.y - k.h / 2), b = transformPoint(pl, k.x + k.w / 2, k.y + k.h / 2);
      layerKeepouts.push({ layer: 'F', rect: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) } });
    }
    for (const p of pl.pkg.pads) {
      const pin = comp.pins.find((q) => q.num === p.num);
      pads.push(placePad(pl, p, pin?.net ?? null));
    }
    if (comp.part.category === 'mosfet' && comp.thermalPins) {
      for (const tp of comp.thermalPins) {
        const net = comp.pins.find((q) => q.num === tp)?.net;
        const pad = pl.pkg.pads.find((q) => q.num === tp);
        if (!net || !pad) continue;
        // heat spreader on both layers, extending outward from the drain pad, with 2 thermal vias
        const x0 = pad.x - pad.w / 2, x1 = pad.x + pad.w / 2 + 1.25, y0 = -1.3, y1 = 1.3;
        const c0 = transformPoint(pl, x0, y0), c1 = transformPoint(pl, x1, y1);
        const rect: Rect = { x: Math.min(c0.x, c1.x), y: Math.min(c0.y, c1.y), w: Math.abs(c1.x - c0.x), h: Math.abs(c1.y - c0.y) };
        zones.push({ net, layer: 'F', rects: [rect], kind: 'thermal' }, { net, layer: 'B', rects: [rect], kind: 'thermal' });
        for (const vy of [-0.75, 0.75]) {
          const v = transformPoint(pl, x1 - 0.45, vy);
          vias.push({ net, x: v.x, y: v.y, d: rules.viaDiameter, drill: rules.viaDrill, kind: 'thermal' });
        }
      }
    }
    if (comp.part.category === 'mcu') {
      const ep = pl.pkg.pads.find((q) => q.num === '41');
      const net = comp.pins.find((q) => q.num === '41')?.net;
      if (ep && net) {
        for (const ix of [-1, 0, 1])
          for (const iy of [-1, 0, 1]) {
            const v = transformPoint(pl, ep.x + ix * 1.1, ep.y + iy * 1.1);
            vias.push({ net, x: v.x, y: v.y, d: rules.viaDiameter, drill: rules.viaDrill, kind: 'thermal' });
          }
      }
    }
  }
  log.push(`配置: ${placements.length} 部品、失敗 ${failures.length}`);
  const fanoutOrder = [...fanoutRank.entries()].sort((a, b) => a[1] - b[1]).map(([n]) => n);
  return { placements, pads, zones, vias, layerKeepouts, keepouts, viaKeepouts, fanoutTracks, fanoutOrder, failures, log };
};
