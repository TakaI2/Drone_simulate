import { PHYSICAL, minArmLength } from '../core/presets';
import { BATTERIES, MOTORS, PROPS } from '../core/propulsion-catalog';
import type { BatterySpec, MotorSpec, PropSpec } from '../core/types';
import { cellOcv } from '../sim/battery';
import { kvRad, rotorCoefficients, steadyCurrent, steadyOmega, voltageForOmega } from '../sim/motor';

export interface SizingRules {
  minTwr: number;
  maxHoverThrottle: number;
  minFlightTimeMin: number;
  usableCapacity: number;
  typicalSoc: number;
  massLimit: number;
  motorCurrentMargin: number;
}

/** Non-propulsion mass model: frame per wheelbase plus fixed extra items. */
export interface MassModel {
  /** Frame mass per metre of motor-to-motor diagonal [kg/m]. */
  frameMassPerWheelbase: number;
  extras: Array<{ item: string; mass: number }>;
}

/** Sizing assumptions (design rules of thumb, not measured values). */
export const SIZING_RULES: SizingRules = {
  minTwr: 2.0,
  maxHoverThrottle: 0.6,
  minFlightTimeMin: 5,
  usableCapacity: 0.8,
  /** SoC at which "typical" pack voltage is evaluated. */
  typicalSoc: 0.5,
  /** Regulatory threshold (Japan: >= 100 g is an unmanned aircraft) [kg]. */
  massLimit: 0.1,
  /** Motor current margin vs. continuous rating. */
  motorCurrentMargin: 1.0,
};

/**
 * Outdoor rules (variant C): extra thrust margin for wind/gusts, lower hover throttle,
 * and a 95 g design target that keeps the built vehicle below the 100 g threshold.
 */
export const SIZING_RULES_OUTDOOR: SizingRules = {
  ...SIZING_RULES,
  minTwr: 3.0,
  maxHoverThrottle: 0.45,
  minFlightTimeMin: 7,
  massLimit: 0.095,
};

/** Mass model for non-propulsion parts of a Class A micro frame. */
export const CLASS_A_MASS_MODEL = {
  /** 3D-printed frame mass per metre of motor-to-motor diagonal [kg/m]. */
  frameMassPerWheelbase: 0.012 / 0.106,
  /** Wiring, screws, tape [kg]. */
  misc: 0.003,
  /** Optical flow + ToF module [kg]. */
  flowModule: 0.002,
} as const;

export const MASS_MODEL_A: MassModel = {
  frameMassPerWheelbase: CLASS_A_MASS_MODEL.frameMassPerWheelbase,
  extras: [
    { item: 'フロー＋ToF モジュール', mass: CLASS_A_MASS_MODEL.flowModule },
    { item: '配線・ねじ等', mass: CLASS_A_MASS_MODEL.misc },
  ],
};

/** Outdoor (variant C) non-propulsion parts. */
export const OUTDOOR_MASS_MODEL = {
  /** Thicker printed arms + bolt-on motor pads [kg/m]. */
  frameMassPerWheelbase: 0.16,
  /** 4-in-1 AM32 ESC, 20x20 mm, 2-4S ~12 A (typical) [kg]. */
  esc: 0.0045,
  /** GNSS + compass module [kg]. */
  gnss: 0.005,
  /** XT30 pigtail, motor wires, screws, spacers, strap [kg]. */
  misc: 0.006,
} as const;

export const MASS_MODEL_OUTDOOR: MassModel = {
  frameMassPerWheelbase: OUTDOOR_MASS_MODEL.frameMassPerWheelbase,
  extras: [
    { item: '4-in-1 ESC（市販）', mass: OUTDOOR_MASS_MODEL.esc },
    { item: 'GNSS＋コンパス', mass: OUTDOOR_MASS_MODEL.gnss },
    { item: '配線・XT30・ねじ等', mass: OUTDOOR_MASS_MODEL.misc },
  ],
};

export interface SizingInput {
  rotorCount: number;
  motor: MotorSpec;
  prop: PropSpec;
  battery: BatterySpec;
  /** Electronics (PCB + components) mass [kg]. */
  electronicsMass: number;
  /** Frame mass; if omitted it is estimated from the wheelbase. */
  frameMass?: number;
  airDensity?: number;
  gravity?: number;
  /** Design rules for the checks (default: Class A rules). */
  rules?: SizingRules;
  /** Non-propulsion mass model (default: Class A). */
  massModel?: MassModel;
}

export interface OperatingPoint {
  omega: number;
  rpm: number;
  throttle: number;
  thrustPerRotor: number;
  motorCurrent: number;
  batteryCurrent: number;
  batteryVoltage: number;
  electricalPower: number;
  mechanicalPowerPerRotor: number;
}

export interface SizingResult {
  input: SizingInput;
  armLength: number;
  wheelbase: number;
  frameMass: number;
  auw: number;
  massBreakdown: Array<{ item: string; mass: number }>;
  kT: number;
  kQ: number;
  hover: OperatingPoint;
  max: OperatingPoint;
  twr: number;
  flightTimeMin: number;
  idealHoverPowerPerRotor: number;
  figureOfMerit: number;
  discLoading: number;
  maxBatteryC: number;
  checks: Array<{ label: string; value: number; limit: number; unit: string; op: 'lt' | 'gte'; pass: boolean }>;
  feasible: boolean;
}

const solveOperatingPoint = (
  n: number,
  motor: MotorSpec,
  battery: BatterySpec,
  kT: number,
  kQ: number,
  mode: { kind: 'thrust'; thrust: number } | { kind: 'full' },
): OperatingPoint => {
  const ocv = battery.cells * cellOcv(SIZING_RULES.typicalSoc);
  let vbat = ocv;
  let op: OperatingPoint | null = null;
  for (let it = 0; it < 30; it++) {
    let omega: number, throttle: number;
    if (mode.kind === 'thrust') {
      omega = Math.sqrt(mode.thrust / kT);
      throttle = voltageForOmega(omega, motor, kQ) / vbat;
    } else {
      throttle = 1;
      omega = steadyOmega(vbat, motor, kQ);
    }
    const im = steadyCurrent(omega, motor, kQ);
    const ib = n * Math.min(1, throttle) * im;
    const vNew = ocv - battery.internalResistance * ib;
    op = {
      omega,
      rpm: (omega * 60) / (2 * Math.PI),
      throttle,
      thrustPerRotor: kT * omega * omega,
      motorCurrent: im,
      batteryCurrent: ib,
      batteryVoltage: vNew,
      electricalPower: vNew * ib,
      mechanicalPowerPerRotor: kQ * omega ** 3,
    };
    if (Math.abs(vNew - vbat) < 1e-6) break;
    vbat = 0.5 * vbat + 0.5 * vNew;
  }
  return op as OperatingPoint;
};

export const sizePropulsion = (inp: SizingInput): SizingResult => {
  const rho = inp.airDensity ?? PHYSICAL.airDensitySeaLevel;
  const g = inp.gravity ?? PHYSICAL.gravity;
  const n = inp.rotorCount;
  const arm = minArmLength(n, inp.prop.diameter);
  const wheelbase = 2 * arm;
  const rules = inp.rules ?? SIZING_RULES;
  const massModel = inp.massModel ?? MASS_MODEL_A;
  const frameMass = inp.frameMass ?? massModel.frameMassPerWheelbase * wheelbase;
  const massBreakdown = [
    { item: `モータ ×${n}`, mass: n * inp.motor.mass },
    { item: `プロペラ ×${n}`, mass: n * inp.prop.mass },
    { item: '電池', mass: inp.battery.mass },
    { item: '電子回路（基板＋部品）', mass: inp.electronicsMass },
    { item: 'フレーム', mass: frameMass },
    ...massModel.extras,
  ];
  const auw = massBreakdown.reduce((s, m) => s + m.mass, 0);
  const { kT, kQ } = rotorCoefficients(inp.prop, rho);
  const hover = solveOperatingPoint(n, inp.motor, inp.battery, kT, kQ, { kind: 'thrust', thrust: (auw * g) / n });
  const max = solveOperatingPoint(n, inp.motor, inp.battery, kT, kQ, { kind: 'full' });
  const twr = (n * max.thrustPerRotor) / (auw * g);
  const flightTimeMin = ((rules.usableCapacity * inp.battery.capacityAh) / hover.batteryCurrent) * 60;
  const area = (Math.PI * inp.prop.diameter ** 2) / 4;
  const idealHoverPowerPerRotor = Math.pow(hover.thrustPerRotor, 1.5) / Math.sqrt(2 * rho * area);
  const figureOfMerit = idealHoverPowerPerRotor / hover.mechanicalPowerPerRotor;
  const maxBatteryC = max.batteryCurrent / inp.battery.capacityAh;
  const c = (label: string, value: number, limit: number, unit: string, op: 'lt' | 'gte') => ({
    label, value, limit, unit, op, pass: op === 'lt' ? value < limit : value >= limit,
  });
  const checks = [
    c('推力重量比 TWR', twr, rules.minTwr, '', 'gte'),
    c('ホバリングスロットル', hover.throttle * 100, rules.maxHoverThrottle * 100, '%', 'lt'),
    c('推定ホバリング飛行時間', flightTimeMin, rules.minFlightTimeMin, 'min', 'gte'),
    c('全備重量', auw * 1000, rules.massLimit * 1000, 'g', 'lt'),
    c('最大放電レート', maxBatteryC, inp.battery.maxDischargeC, 'C', 'lt'),
    c('モータ最大電流', max.motorCurrent, inp.motor.maxCurrent * rules.motorCurrentMargin, 'A', 'lt'),
  ];
  return {
    input: inp,
    armLength: arm,
    wheelbase,
    frameMass,
    auw,
    massBreakdown,
    kT,
    kQ,
    hover,
    max,
    twr,
    flightTimeMin,
    idealHoverPowerPerRotor,
    figureOfMerit,
    discLoading: hover.thrustPerRotor / area,
    maxBatteryC,
    checks,
    feasible: checks.every((x) => x.pass),
  };
};

/** Shaft/bore compatibility and voltage class (brushed coreless -> 1S, brushless 22xx -> 3S+). */
const compatible = (m: MotorSpec, p: PropSpec, b: BatterySpec): boolean => {
  if (Math.abs(p.bore - m.shaftDiameter) > 0.0001) return false;
  const maxNoLoadRpm = m.kv * b.cells * b.cellVoltageMax;
  // keep no-load tip speed below ~0.6 Mach (noise/efficiency) and avoid over-volting brushed motors
  const tip = ((maxNoLoadRpm / 60) * Math.PI * p.diameter) / 343;
  if (tip > 0.6) return false;
  if (m.kind === 'brushed' && b.cells > 1) return false;
  return true;
};

export interface SearchResult {
  all: SizingResult[];
  feasible: SizingResult[];
  best: SizingResult | null;
}

/** Exhaustive search over the propulsion catalog. */
export interface SearchOptions {
  motors?: MotorSpec[];
  props?: PropSpec[];
  batteries?: BatterySpec[];
  rules?: SizingRules;
  massModel?: MassModel;
}

export const searchPropulsion = (rotorCount: number, electronicsMass: number, o: SearchOptions = {}): SearchResult => {
  const all: SizingResult[] = [];
  for (const motor of o.motors ?? MOTORS)
    for (const prop of o.props ?? PROPS)
      for (const battery of o.batteries ?? BATTERIES) {
        if (!compatible(motor, prop, battery)) continue;
        all.push(sizePropulsion({ rotorCount, motor, prop, battery, electronicsMass, rules: o.rules, massModel: o.massModel }));
      }
  // generic multi-vendor parts first (plan: low vendor lock-in), then longest flight time
  const rank = (r: SizingResult): number =>
    (r.input.motor.availability === 'limited' ? 1 : 0) + (r.input.prop.availability === 'limited' ? 1 : 0);
  const feasible = all.filter((r) => r.feasible).sort((a, b) => rank(a) - rank(b) || b.flightTimeMin - a.flightTimeMin);
  return { all, feasible, best: feasible[0] ?? null };
};

export { kvRad };

/** Static thrust / current vs throttle for one rotor (battery sag included). */
export const throttleCurve = (r: SizingResult, steps = 20): Array<{ throttle: number; thrustG: number; motorCurrent: number; batteryCurrent: number }> => {
  const { motor, battery } = r.input;
  const n = r.input.rotorCount;
  const g = r.input.gravity ?? PHYSICAL.gravity;
  const out: Array<{ throttle: number; thrustG: number; motorCurrent: number; batteryCurrent: number }> = [];
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    let vbat = battery.cells * cellOcv(SIZING_RULES.typicalSoc);
    let omega = 0, im = 0, ib = 0;
    for (let it = 0; it < 30; it++) {
      omega = steadyOmega(u * vbat, motor, r.kQ);
      im = steadyCurrent(omega, motor, r.kQ);
      ib = n * u * im;
      const v = battery.cells * cellOcv(SIZING_RULES.typicalSoc) - battery.internalResistance * ib;
      if (Math.abs(v - vbat) < 1e-6) break;
      vbat = 0.5 * (vbat + v);
    }
    out.push({ throttle: u, thrustG: ((r.kT * omega * omega) / g) * 1000, motorCurrent: im, batteryCurrent: ib });
  }
  return out;
};
