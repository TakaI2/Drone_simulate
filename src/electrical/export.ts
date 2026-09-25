import { vendorLinks } from './catalog';
import type { Circuit } from './circuit';

export interface BomLine {
  partId: string;
  refs: string[];
  qty: number;
  name: string;
  value: string;
  mpn: string;
  manufacturer: string;
  package: string;
  unitMassG: number;
  totalMassG: number;
  alternatives: string;
  verify: string;
}

export const buildBom = (c: Circuit): BomLine[] => {
  const map = new Map<string, BomLine>();
  for (const comp of c.components) {
    const p = comp.part;
    const line = map.get(p.id) ?? {
      partId: p.id,
      refs: [],
      qty: 0,
      name: p.name,
      value: comp.value,
      mpn: p.mpn,
      manufacturer: p.manufacturer,
      package: p.package,
      unitMassG: p.massG,
      totalMassG: 0,
      alternatives: p.alternatives.map((a) => `${a.manufacturer} ${a.mpn}`).join(' / '),
      verify: p.verify ?? '',
    };
    line.refs.push(comp.ref);
    line.qty++;
    line.totalMassG = line.qty * line.unitMassG;
    map.set(p.id, line);
  }
  return [...map.values()].sort((a, b) => a.refs[0].localeCompare(b.refs[0], 'en', { numeric: true }));
};

const csvCell = (s: string | number): string => {
  const t = String(s);
  return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

export const bomCsv = (bom: BomLine[]): string => {
  const head = ['Refs', 'Qty', 'Name', 'Value', 'MPN', 'Manufacturer', 'Package', 'UnitMass_g', 'Alternatives', 'Verify', 'Search'];
  const rows = bom.map((b) => [
    b.refs.join(' '),
    b.qty,
    b.name,
    b.value,
    b.mpn,
    b.manufacturer,
    b.package,
    b.unitMassG,
    b.alternatives,
    b.verify,
    vendorLinks(b.mpn)[0]?.url ?? '',
  ]);
  return '﻿' + [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
};

/** KiCad (legacy S-expression) netlist, importable into Pcbnew. */
export const kicadNetlist = (c: Circuit): string => {
  const q = (s: string): string => `"${s.replace(/"/g, '\\"')}"`;
  const comps = c.components
    .map((comp) => `    (comp (ref ${q(comp.ref)}) (value ${q(comp.value)}) (footprint ${q(`DroneDesign:${comp.part.package}`)}) (fields (field (name "MPN") ${q(comp.part.mpn)})))`)
    .join('\n');
  const nets = c.nets
    .map((n, i) => `    (net (code ${i + 1}) (name ${q(n.name)})\n${n.pins.map((p) => `      (node (ref ${q(p.ref)}) (pin ${q(p.pin)}))`).join('\n')})`)
    .join('\n');
  return `(export (version "E")\n  (design (source "drone-design-studio") (tool "drone-design-studio"))\n  (components\n${comps})\n  (nets\n${nets}))\n`;
};

export const netlistJson = (c: Circuit): object => ({
  name: c.name,
  components: c.components.map((x) => ({ ref: x.ref, part: x.partId, mpn: x.part.mpn, package: x.part.package, block: x.block, pins: x.pins })),
  nets: c.nets,
  gpio: c.gpio,
});
