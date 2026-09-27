import { computeElectrical } from '../electrical/calc';
import type { ElectricalCalc } from '../electrical/calc';
import { generateCircuit } from '../electrical/circuit';
import type { Circuit, CircuitOptions } from '../electrical/circuit';
import { buildBom } from '../electrical/export';
import type { BomLine } from '../electrical/export';
import { searchPropulsion, sizePropulsion } from '../sizing/propulsion';
import type { SearchOptions, SearchResult, SizingResult } from '../sizing/propulsion';
import { findBattery, findMotor, findProp } from '../core/propulsion-catalog';

/** Board assumptions before the PCB is laid out (refined in stage 3). */
export const BOARD_DEFAULTS = {
  width: 40,
  height: 40,
  thickness: 0.8,
  /** FR-4 density [g/cm^3]. */
  fr4Density: 1.85,
  /** Copper coverage (both layers, 35 um) as fraction of board area. */
  copperCoverage: 0.7,
  copperDensity: 8.96,
  copperThicknessMm: 0.035,
  /** Solder + mask allowance [g]. */
  solderAllowance: 0.3,
  /** Mass guess before the first circuit exists [kg]. */
  initialElectronicsMass: 0.008,
} as const;

export const pcbMassG = (widthMm: number, heightMm: number, thicknessMm: number = BOARD_DEFAULTS.thickness): number => {
  const areaCm2 = (widthMm * heightMm) / 100;
  const fr4 = areaCm2 * (thicknessMm / 10) * BOARD_DEFAULTS.fr4Density;
  const cu = areaCm2 * 2 * (BOARD_DEFAULTS.copperThicknessMm / 10) * BOARD_DEFAULTS.copperDensity * BOARD_DEFAULTS.copperCoverage;
  return fr4 + cu + BOARD_DEFAULTS.solderAllowance;
};

/** Parts that are not flown (programming header) are excluded from the flying mass. */
const NOT_FLOWN = new Set(['PinHeader-1x6']);

export const electronicsMassG = (bom: BomLine[], boardW: number, boardH: number): number =>
  bom.filter((b) => !NOT_FLOWN.has(b.partId)).reduce((s, b) => s + b.totalMassG, 0) + pcbMassG(boardW, boardH);

export interface Stage2Iteration {
  iter: number;
  electronicsMassG: number;
  choice: string;
  auwG: number;
  twr: number;
  flightTimeMin: number;
}

export interface Stage2Result {
  rotorCount: number;
  search: SearchResult;
  sizing: SizingResult;
  circuit: Circuit;
  calc: ElectricalCalc;
  bom: BomLine[];
  electronicsMassG: number;
  iterations: Stage2Iteration[];
}

export interface Stage2Options {
  rotorCount: number;
  /** Variant B: add the GNSS connector to the main board. */
  gnssConnector?: boolean;
  /** Force a propulsion combination instead of the search result. */
  override?: { motorId: string; propId: string; batteryId: string };
  boardW?: number;
  boardH?: number;
  maxIterations?: number;
  /** Variant C: candidate catalog, rules and mass model for the search. */
  search?: SearchOptions;
  /** Variant C: supply / motor-drive options of the circuit. */
  circuit?: Pick<CircuitOptions, 'power' | 'motorDrive'>;
  /** Electrical checks (default: variant A calculation). */
  electrical?: (circuit: Circuit, sizing: SizingResult) => ElectricalCalc;
}

export const runStage2 = (o: Stage2Options): Stage2Result => {
  const boardW = o.boardW ?? BOARD_DEFAULTS.width;
  const boardH = o.boardH ?? BOARD_DEFAULTS.height;
  let mass = BOARD_DEFAULTS.initialElectronicsMass;
  const iterations: Stage2Iteration[] = [];
  const circuitOptions: CircuitOptions = { rotorCount: o.rotorCount, gnssConnector: o.gnssConnector, ...o.circuit };
  let search = searchPropulsion(o.rotorCount, mass, o.search);
  let sizing: SizingResult | null = null;
  let circuit = generateCircuit(circuitOptions);
  let bom = buildBom(circuit);
  for (let it = 0; it < (o.maxIterations ?? 6); it++) {
    search = searchPropulsion(o.rotorCount, mass, o.search);
    sizing = o.override
      ? sizePropulsion({ rotorCount: o.rotorCount, motor: findMotor(o.override.motorId), prop: findProp(o.override.propId), battery: findBattery(o.override.batteryId), electronicsMass: mass, rules: o.search?.rules, massModel: o.search?.massModel })
      : search.best;
    if (!sizing) throw new Error('条件を満たす推進系の組合せがありません');
    circuit = generateCircuit(circuitOptions);
    bom = buildBom(circuit);
    const newMassG = electronicsMassG(bom, boardW, boardH);
    iterations.push({
      iter: it,
      electronicsMassG: mass * 1000,
      choice: `${sizing.input.motor.id} / ${sizing.input.prop.id} / ${sizing.input.battery.id}`,
      auwG: sizing.auw * 1000,
      twr: sizing.twr,
      flightTimeMin: sizing.flightTimeMin,
    });
    const converged = Math.abs(newMassG / 1000 - mass) < 1e-4;
    mass = newMassG / 1000;
    if (converged) break;
  }
  const finalSizing = sizing as SizingResult;
  const calc = (o.electrical ?? computeElectrical)(circuit, finalSizing);
  return { rotorCount: o.rotorCount, search, sizing: finalSizing, circuit, calc, bom, electronicsMassG: mass * 1000, iterations };
};
