import type { Circuit } from '../electrical/circuit';
import type { PcbDesign } from './types';

/**
 * KiCad 8 board file (.kicad_pcb) with embedded footprints so it opens without libraries.
 * Ground pours are exported as zone outlines (press "B" in KiCad to refill); tracks and vias are exact.
 * KiCad uses a y-down coordinate system: y is negated.
 */
export const exportKicadPcb = (d: PcbDesign, circuit: Circuit): string => {
  const q = (s: string): string => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  const f = (v: number): string => (Math.abs(v) < 5e-7 ? '0' : v.toFixed(4).replace(/0+$/, '').replace(/\.$/, ''));
  const netNames = ['', ...circuit.nets.map((n) => n.name)];
  const netIdx = new Map(netNames.map((n, i) => [n, i]));
  const net = (name: string | null): string => (name ? `(net ${netIdx.get(name) ?? 0} ${q(name)})` : '');
  const out: string[] = [];
  out.push('(kicad_pcb (version 20240108) (generator "drone_design_studio") (generator_version "0.1")');
  out.push(`  (general (thickness ${d.rules.boardThickness}) (legacy_teardrops no))`);
  out.push('  (paper "A4")');
  out.push('  (layers (0 "F.Cu" signal) (31 "B.Cu" signal) (34 "B.Paste" user) (35 "F.Paste" user) (36 "B.SilkS" user "B.Silkscreen") (37 "F.SilkS" user "F.Silkscreen") (38 "B.Mask" user) (39 "F.Mask" user) (44 "Edge.Cuts" user) (46 "B.CrtYd" user "B.Courtyard") (47 "F.CrtYd" user "F.Courtyard") (48 "B.Fab" user) (49 "F.Fab" user))');
  out.push(`  (setup (pad_to_mask_clearance ${d.rules.maskExpansion}))`);
  netNames.forEach((n, i) => out.push(`  (net ${i} ${q(n)})`));
  const comps = new Map(circuit.components.map((c) => [c.ref, c]));
  for (const pl of d.placements) {
    const comp = comps.get(pl.ref);
    out.push(`  (footprint ${q(`DroneDesign:${pl.pkg.id}`)} (layer "F.Cu") (at ${f(pl.x)} ${f(-pl.y)} ${pl.rot})`);
    out.push(`    (property "Reference" ${q(pl.ref)} (at 0 ${f(-(pl.pkg.courtyard.h + 0.6))} ${pl.rot}) (layer "F.SilkS") (effects (font (size 0.8 0.8) (thickness 0.15))))`);
    out.push(`    (property "Value" ${q(comp?.value ?? pl.pkg.id)} (at 0 ${f(pl.pkg.courtyard.h + 0.6)} ${pl.rot}) (layer "F.Fab") (effects (font (size 0.8 0.8) (thickness 0.12))))`);
    const cw = pl.pkg.courtyard.w, ch = pl.pkg.courtyard.h;
    out.push(`    (fp_rect (start ${f(-cw)} ${f(-ch)}) (end ${f(cw)} ${f(ch)}) (stroke (width 0.05) (type default)) (fill none) (layer "F.CrtYd"))`);
    for (const p of pl.pkg.pads) {
      const pin = comp?.pins.find((x) => x.num === p.num);
      const shape = p.shape === 'roundrect' ? 'roundrect' : p.shape === 'oval' ? 'oval' : p.shape === 'circle' ? 'circle' : 'rect';
      const rr = shape === 'roundrect' ? ' (roundrect_rratio 0.25)' : '';
      if (p.npth) {
        out.push(`    (pad "" np_thru_hole circle (at ${f(p.x)} ${f(-p.y)} ${pl.rot}) (size ${f(p.w)} ${f(p.w)}) (drill ${f(p.drill ?? p.w)}) (layers "*.Cu" "*.Mask"))`);
      } else if (p.drill) {
        out.push(`    (pad ${q(p.num)} thru_hole ${shape} (at ${f(p.x)} ${f(-p.y)} ${pl.rot}) (size ${f(p.w)} ${f(p.h)}) (drill ${f(p.drill)}) (layers "*.Cu" "*.Mask")${rr} ${net(pin?.net ?? null)})`);
      } else {
        out.push(`    (pad ${q(p.num)} smd ${shape} (at ${f(p.x)} ${f(-p.y)} ${pl.rot}) (size ${f(p.w)} ${f(p.h)}) (layers "F.Cu" "F.Paste" "F.Mask")${rr} ${net(pin?.net ?? null)})`);
      }
    }
    out.push('  )');
  }
  for (const t of d.tracks) {
    out.push(`  (segment (start ${f(t.x1)} ${f(-t.y1)}) (end ${f(t.x2)} ${f(-t.y2)}) (width ${f(t.width)}) (layer ${q(t.layer === 'F' ? 'F.Cu' : 'B.Cu')}) ${net(t.net)})`);
  }
  for (const v of d.vias) out.push(`  (via (at ${f(v.x)} ${f(-v.y)}) (size ${f(v.d)}) (drill ${f(v.drill)}) (layers "F.Cu" "B.Cu") ${net(v.net)})`);
  // thermal copper as filled zones of their net; ground as refillable pours over the whole board
  for (const z of d.zones.filter((x) => x.kind === 'thermal')) {
    for (const rc of z.rects) {
      out.push(`  (zone ${net(z.net)} (layer ${q(z.layer === 'F' ? 'F.Cu' : 'B.Cu')}) (hatch edge 0.5) (priority 1) (connect_pads yes (clearance ${d.rules.clearance})) (min_thickness 0.2) (fill yes (thermal_gap 0.3) (thermal_bridge_width 0.3))`);
      out.push(`    (polygon (pts (xy ${f(rc.x)} ${f(-rc.y)}) (xy ${f(rc.x + rc.w)} ${f(-rc.y)}) (xy ${f(rc.x + rc.w)} ${f(-(rc.y + rc.h))}) (xy ${f(rc.x)} ${f(-(rc.y + rc.h))}))))`);
    }
  }
  const hw = d.board.w / 2 - d.rules.edgeClearance, hh = d.board.h / 2 - d.rules.edgeClearance;
  for (const L of ['F.Cu', 'B.Cu']) {
    out.push(`  (zone ${net('GND')} (layer ${q(L)}) (hatch edge 0.5) (connect_pads (clearance ${d.rules.clearance})) (min_thickness 0.2) (fill yes (thermal_gap 0.3) (thermal_bridge_width 0.3))`);
    out.push(`    (polygon (pts (xy ${f(-hw)} ${f(-hh)}) (xy ${f(hw)} ${f(-hh)}) (xy ${f(hw)} ${f(hh)}) (xy ${f(-hw)} ${f(hh)}))))`);
  }
  for (const k of d.layerKeepouts) {
    out.push(`  (zone (net 0) (net_name "") (layer ${q(k.layer === 'F' ? 'F.Cu' : 'B.Cu')}) (hatch edge 0.5) (connect_pads (clearance 0)) (min_thickness 0.2) (keepout (tracks not_allowed) (vias not_allowed) (pads allowed) (copperpour not_allowed) (footprints allowed))`);
    out.push(`    (polygon (pts (xy ${f(k.rect.x)} ${f(-k.rect.y)}) (xy ${f(k.rect.x + k.rect.w)} ${f(-k.rect.y)}) (xy ${f(k.rect.x + k.rect.w)} ${f(-(k.rect.y + k.rect.h))}) (xy ${f(k.rect.x)} ${f(-(k.rect.y + k.rect.h))}))))`);
  }
  // outline with rounded corners
  const W = d.board.w / 2, H = d.board.h / 2, r = d.board.cornerRadius;
  out.push(`  (gr_line (start ${f(-W + r)} ${f(-H)}) (end ${f(W - r)} ${f(-H)}) (stroke (width 0.1) (type default)) (layer "Edge.Cuts"))`);
  out.push(`  (gr_line (start ${f(W)} ${f(-H + r)}) (end ${f(W)} ${f(H - r)}) (stroke (width 0.1) (type default)) (layer "Edge.Cuts"))`);
  out.push(`  (gr_line (start ${f(W - r)} ${f(H)}) (end ${f(-W + r)} ${f(H)}) (stroke (width 0.1) (type default)) (layer "Edge.Cuts"))`);
  out.push(`  (gr_line (start ${f(-W)} ${f(H - r)}) (end ${f(-W)} ${f(-H + r)}) (stroke (width 0.1) (type default)) (layer "Edge.Cuts"))`);
  const arcs: Array<[number, number, number]> = [[W - r, -H + r, -90], [W - r, H - r, 0], [-W + r, H - r, 90], [-W + r, -H + r, 180]];
  for (const [cx, cy, a0] of arcs) {
    const a = (deg: number): [number, number] => [cx + r * Math.cos((deg * Math.PI) / 180), -(cy + r * Math.sin((deg * Math.PI) / 180))];
    const [sx, sy] = a(a0), [mx, my] = a(a0 + 45), [ex, ey] = a(a0 + 90);
    out.push(`  (gr_arc (start ${f(sx)} ${f(sy)}) (mid ${f(mx)} ${f(my)}) (end ${f(ex)} ${f(ey)}) (stroke (width 0.1) (type default)) (layer "Edge.Cuts"))`);
  }
  out.push(')');
  return out.join('\n') + '\n';
};
