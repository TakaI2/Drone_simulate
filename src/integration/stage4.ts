import type { ManifoldToplevel } from 'manifold-3d';
import { designAirframe } from '../airframe/design';
import type { AirframeDesign, AirframeInput } from '../airframe/design';
import { findPart } from '../electrical/catalog';
import { CLASS_A_MASS_MODEL } from '../sizing/propulsion';
import type { Stage2Result } from './stage2';
import type { PcbDesign } from '../pcb/types';

/** The parts of the stage-3 result stage 4 needs (can be loaded from out/stage3/pcb.json). */
export interface Stage3Lite {
  pcb: { design: PcbDesign };
  boardMassG: number;
}

export const airframeInputFrom = (s2: Stage2Result, s3: Stage3Lite): AirframeInput => {
  const s = s2.sizing;
  const d = s3.pcb.design;
  const massByRef = new Map<string, number>();
  for (const b of s2.bom) for (const r of b.refs) massByRef.set(r, b.partId === 'PinHeader-1x6' ? 0 : b.unitMassG);
  const holes = d.placements.filter((p) => p.pkg.family === 'mechanical').map((p) => ({ x: p.x, y: p.y }));
  const mcu = d.placements.find((p) => p.pkg.family === 'module');
  const flow = findPart('FlowToF-Module');
  return {
    rotorCount: s2.rotorCount,
    armLength: s.armLength * 1000,
    motor: { diameter: s.input.motor.diameter * 1000, length: s.input.motor.length * 1000, massG: s.input.motor.mass * 1000 },
    prop: { diameter: s.input.prop.diameter * 1000, massG: s.input.prop.mass * 1000, blades: s.input.prop.blades },
    battery: { size: [s.input.battery.size.x * 1000, s.input.battery.size.y * 1000, s.input.battery.size.z * 1000], massG: s.input.battery.mass * 1000 },
    pcb: {
      w: d.board.w,
      h: d.board.h,
      thickness: d.rules.boardThickness,
      holes,
      boardMassG: s3.boardMassG,
      parts: d.placements.map((p) => ({ ref: p.ref, x: p.x, y: p.y, massG: massByRef.get(p.ref) ?? 0, height: p.pkg.height })),
      antennaOverhang: mcu?.pkg.overhang?.length ?? 0,
    },
    flow: { size: flow.dims, massG: flow.massG },
    miscMassG: CLASS_A_MASS_MODEL.misc * 1000,
    maxThrustN: s.max.thrustPerRotor,
  };
};

export const runStage4 = (wasm: ManifoldToplevel, s2: Stage2Result, s3: Stage3Lite): AirframeDesign => designAirframe(wasm, airframeInputFrom(s2, s3));

/** Serializable summary (no mesh) for the UI and stage 5. */
export const airframeSummary = (a: AirframeDesign): object => ({
  massG: a.massG,
  cg: a.cg,
  inertia: a.inertia,
  battery: a.battery,
  rotors: a.rotors,
  pcbZ: a.pcbZ,
  plate: a.plate,
  frameMassG: a.frameMassG,
  frameVolumeMm3: a.frameVolumeMm3,
  items: a.items.map((i) => ({ name: i.name, massG: i.massG, center: i.center, shape: i.shape, size: i.size })),
  checks: a.checks,
  iterations: a.iterations,
  bounds: a.bounds,
  watertight: a.watertight,
  input: a.input,
});
