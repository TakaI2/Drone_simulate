import type { ManifoldToplevel } from 'manifold-3d';
import { designAirframe } from '../airframe/design';
import type { AirframeDesign, AirframeInput } from '../airframe/design';
import { GAINS_OUTDOOR, GNSS_MODULE, OUTDOOR_BUILD, SENSORS_GNSS_M10 } from '../core/presets';
import { BATTERIES_OUTDOOR, MOTORS_OUTDOOR, PROPS_OUTDOOR } from '../core/propulsion-catalog';
import type { DroneParams } from '../core/types';
import { computeElectricalEsc } from '../electrical/calc-esc';
import { findPart } from '../electrical/catalog';
import { MASS_MODEL_OUTDOOR, OUTDOOR_MASS_MODEL, SIZING_RULES_OUTDOOR } from '../sizing/propulsion';
import type { MassModel, SearchOptions } from '../sizing/propulsion';
import { runStage2 } from './stage2';
import type { Stage2Result } from './stage2';
import { runStage3 } from './stage3';
import type { Stage3Result } from './stage3';
import { airframeInputFrom } from './stage4';
import type { Stage3Lite } from './stage4';
import { deriveDroneParams } from './stage5';
import type { AirframeLike } from './stage5';

/** Outdoor candidate catalog, rules and mass model (variant C). */
export const OUTDOOR_SEARCH: SearchOptions = {
  motors: MOTORS_OUTDOOR,
  props: PROPS_OUTDOOR,
  batteries: BATTERIES_OUTDOOR,
  rules: SIZING_RULES_OUTDOOR,
  massModel: MASS_MODEL_OUTDOOR,
};

/**
 * Stage 2 for variant C. The second pass uses the frame mass measured on the generated mesh
 * (`calibratedMassModel`) and the real board outline instead of the per-wheelbase estimate.
 */
export const runStage2C = (o: { massModel?: MassModel; board?: { w: number; h: number } } = {}): Stage2Result =>
  runStage2({
    rotorCount: 4,
    gnssConnector: true,
    boardW: o.board?.w ?? OUTDOOR_BUILD.boardSizes[0],
    boardH: o.board?.h ?? OUTDOOR_BUILD.boardSizes[0],
    search: { ...OUTDOOR_SEARCH, massModel: o.massModel ?? OUTDOOR_SEARCH.massModel },
    circuit: { power: 'buck', motorDrive: 'esc' },
    electrical: computeElectricalEsc,
  });

/** ESC harness connector on the module edge that carries the ESC signals; GNSS port on the opposite edge. */
export const boardAnchorsC = (_w: number, h: number): Array<{ ref: string; x: number; y: number; rot: number }> => [
  { ref: 'J1', x: -8, y: -(h / 2 - 2.8), rot: 0 },
  { ref: 'J4', x: 6, y: h / 2 - 2.8, rot: 180 },
];

export const runStage3C = (s2: Stage2Result): Stage3Result =>
  runStage3(s2, {
    pcb: {
      boardSizes: [...OUTDOOR_BUILD.boardSizes],
      anchors: boardAnchorsC,
      fanoutAwareCourtyard: true,
      maxRerouteAttempts: OUTDOOR_BUILD.maxRerouteAttempts,
    },
    label: 'DDS-C FC V0.1',
  });

export const airframeInputC = (s2: Stage2Result, s3: Stage3Lite): AirframeInput => {
  const base = airframeInputFrom(s2, s3);
  const esc = findPart('ESC-4in1-AM32');
  return {
    ...base,
    motor: { ...base.motor, mountSpacing: (s2.sizing.input.motor.mountSpacing ?? 0.009) * 1000 },
    motorMount: 'bolt',
    frame: { ...OUTDOOR_BUILD.frame },
    esc: { name: '4-in-1 ESC（市販、AM32）', size: esc.dims, massG: esc.massG, holeSpacing: OUTDOOR_BUILD.escHoleSpacing, postHeight: OUTDOOR_BUILD.escPostHeight },
    gnss: { name: GNSS_MODULE.name, size: [...GNSS_MODULE.size], massG: GNSS_MODULE.massG },
    flow: undefined,
    miscMassG: OUTDOOR_MASS_MODEL.misc * 1000,
  };
};

/** Replace the frame-mass estimate with the value of a generated frame (same arm/pad design). */
export const calibratedMassModel = (s2: Stage2Result, af: AirframeDesign): MassModel => ({
  ...MASS_MODEL_OUTDOOR,
  frameMassPerWheelbase: af.frameMassG / 1000 / s2.sizing.wheelbase,
});

export const designAirframeC = (wasm: ManifoldToplevel, s2: Stage2Result, s3: Stage3Lite): AirframeDesign => designAirframe(wasm, airframeInputC(s2, s3));

/** Simulation model of the variant C vehicle: design values + GNSS sensors + outdoor limits. */
export const droneParamsC = (s2: Stage2Result, af: AirframeLike): DroneParams => ({
  ...deriveDroneParams(s2.sizing, af),
  name: '版 C 屋外機（ブラシレス 2S・GNSS、設計値から導出）',
  sensors: SENSORS_GNSS_M10,
  gains: GAINS_OUTDOOR,
  landCellVoltage: OUTDOOR_BUILD.landCellVoltage,
});
