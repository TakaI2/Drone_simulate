import type { ManifoldToplevel } from 'manifold-3d';
import { designAirframe, FRAME_DEFAULTS } from '../airframe/design';
import type { AirframeDesign } from '../airframe/design';
import { FLOW_BOARD, flowBoardAnchors, flowBoardHoles, generateFlowBoard } from '../electrical/flowboard';
import type { Circuit } from '../electrical/circuit';
import { buildBom } from '../electrical/export';
import type { BomLine } from '../electrical/export';
import { generateGerbers } from '../pcb/gerber';
import type { GerberSet } from '../pcb/gerber';
import { exportKicadPcb } from '../pcb/kicad';
import { designPcb } from '../pcb/pipeline';
import type { PcbPipelineResult } from '../pcb/pipeline';
import { pcbMassG } from './stage2';
import { airframeInputFrom } from './stage4';
import type { Stage3Lite } from './stage4';
import type { Stage2Result } from './stage2';

export { GNSS_MODULE } from '../core/presets';

export interface FlowBoardResult {
  circuit: Circuit;
  pcb: PcbPipelineResult;
  gerbers: GerberSet;
  kicad: string;
  bom: BomLine[];
  /** Board + parts + lens [g]. */
  massG: number;
  /** Assembled height below the plate (board + tallest part + lens) [mm]. */
  heightMm: number;
}

export const designFlowBoard = (): FlowBoardResult => {
  const circuit = generateFlowBoard();
  const pcb = designPcb(circuit, {
    rotorAngles: [],
    boardDims: FLOW_BOARD.sizes,
    holePositions: (w) => flowBoardHoles(w),
    anchors: flowBoardAnchors,
    placementOrder: 'largest-first',
    fanoutAwareCourtyard: true,
    cornerRadius: 1.5,
    name: circuit.name,
  });
  const d = pcb.design;
  const bom = buildBom(circuit);
  const values = Object.fromEntries(circuit.components.map((c) => [c.ref, c.value]));
  const gerbers = generateGerbers(d, values, ['DDS-A FLOW V0.1']);
  const kicad = exportKicadPcb(d, circuit);
  const partsMass = bom.reduce((s, b) => s + b.totalMassG, 0);
  const massG = pcbMassG(d.board.w, d.board.h, d.rules.boardThickness) + partsMass + FLOW_BOARD.lens.massG;
  const tallest = Math.max(...d.placements.map((p) => p.pkg.height));
  const flowSensor = d.placements.find((p) => p.pkg.id === 'PMW3901MB');
  const heightMm = d.rules.boardThickness + Math.max(tallest, (flowSensor?.pkg.height ?? 0) + FLOW_BOARD.lens.height);
  return { circuit, pcb, gerbers, kicad, bom, massG, heightMm };
};

/** Variant B airframe: longer nose for the sub-board, matching holes and a cable slot. */
export const designAirframeB = (wasm: ManifoldToplevel, s2: Stage2Result, s3: Stage3Lite, flow: FlowBoardResult): AirframeDesign => {
  const base = airframeInputFrom(s2, s3);
  const b = flow.pcb.design.board;
  const holes = flowBoardHoles(b.w);
  return designAirframe(wasm, {
    ...base,
    flow: {
      name: '自作センサ子基板（フロー＋ToF）',
      size: [b.w, b.h, flow.heightMm],
      massG: flow.massG,
      // component side faces the floor: the board is mirrored about x, holes on the x axis are unchanged
      holes,
      cableSlot: true,
      noseLength: Math.max(FRAME_DEFAULTS.noseLength, b.w + 2),
      noseWidth: Math.max(FRAME_DEFAULTS.noseWidth, b.h),
    },
  });
};
