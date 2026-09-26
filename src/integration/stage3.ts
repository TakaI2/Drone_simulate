import { buildBreadboard } from '../electrical/breadboard';
import type { BreadboardLayout } from '../electrical/breadboard';
import { vendorLinks } from '../electrical/catalog';
import type { VendorLink } from '../electrical/catalog';
import { getPackage } from '../parts3d/packages';
import { generateGerbers } from '../pcb/gerber';
import type { GerberSet } from '../pcb/gerber';
import { exportKicadPcb } from '../pcb/kicad';
import { designPcb } from '../pcb/pipeline';
import type { PcbPipelineResult } from '../pcb/pipeline';
import { pcbMassG } from './stage2';
import type { Stage2Result } from './stage2';

export interface CatalogMapping {
  refs: string;
  qty: number;
  partId: string;
  mpn: string;
  manufacturer: string;
  package: string;
  hasDims: boolean;
  hasMass: boolean;
  has3d: boolean;
  dims: [number, number, number];
  massG: number;
  vendors: VendorLink[];
  alternatives: number;
  verify: string;
}

export interface Stage3Result {
  pcb: PcbPipelineResult;
  gerbers: GerberSet;
  kicad: string;
  breadboard: BreadboardLayout;
  mapping: CatalogMapping[];
  boardMassG: number;
  electronicsMassG: number;
}

/** Rotor arm directions from the stage-2 layout (same convention as the simulator). */
export const rotorAnglesOf = (n: number): number[] => Array.from({ length: n }, (_, i) => -Math.PI / 2 + Math.PI / n + (2 * Math.PI * i) / n);

export const runStage3 = (s2: Stage2Result): Stage3Result => {
  const pcb = designPcb(s2.circuit, { rotorAngles: rotorAnglesOf(s2.rotorCount), name: s2.circuit.name });
  const values = Object.fromEntries(s2.circuit.components.map((c) => [c.ref, c.value]));
  const gerbers = generateGerbers(pcb.design, values, ['DDS-A FC V0.1']);
  const kicad = exportKicadPcb(pcb.design, s2.circuit);
  const breadboard = buildBreadboard(s2.rotorCount);
  const mapping: CatalogMapping[] = s2.bom.map((b) => {
    const part = s2.circuit.components.find((c) => c.partId === b.partId)!.part;
    let has3d = false;
    try {
      has3d = part.package === 'external' || getPackage(part.package) !== null;
    } catch {
      has3d = false;
    }
    return {
      refs: b.refs.join(', '),
      qty: b.qty,
      partId: b.partId,
      mpn: part.mpn,
      manufacturer: part.manufacturer,
      package: part.package,
      hasDims: part.dims.every((x) => Number.isFinite(x)) && part.dims[0] > 0,
      hasMass: Number.isFinite(part.massG),
      has3d,
      dims: part.dims,
      massG: part.massG,
      vendors: vendorLinks(part.mpn),
      alternatives: part.alternatives.length,
      verify: part.verify ?? '',
    };
  });
  const boardMassG = pcbMassG(pcb.design.board.w, pcb.design.board.h, pcb.design.rules.boardThickness);
  const partsMass = s2.bom.filter((b) => b.partId !== 'PinHeader-1x6').reduce((s, b) => s + b.totalMassG, 0);
  return { pcb, gerbers, kicad, breadboard, mapping, boardMassG, electronicsMassG: boardMassG + partsMass };
};
