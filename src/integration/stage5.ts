import { motorHeights } from '../airframe/design';
import type { AirframeInput } from '../airframe/design';
import { v3 } from '../core/math';
import { GAINS_DEFAULT, SENSORS_MICRO } from '../core/presets';
import type { DroneParams, RotorSpec } from '../core/types';
import type { SizingResult } from '../sizing/propulsion';

/** Airframe data needed to derive simulation parameters (subset of the stage-4 summary JSON). */
export interface AirframeLike {
  massG: number;
  cg: [number, number, number];
  /** g mm^2, row-major. */
  inertia: number[];
  rotors: Array<{ x: number; y: number; hubZ: number; spin: 1 | -1 }>;
  input: AirframeInput;
  pcbZ: number;
}

/** Values measured on the real vehicle (thrust stand, scale, pendulum) that override the design values. */
export interface MeasuredOverrides {
  ct?: number;
  cp?: number;
  motorTimeConstant?: number;
  massG?: number;
  inertiaScale?: number;
}

/** Aerodynamic estimate constants for the derived model. */
const AERO = {
  cd: 1.2,
  /** Fraction of the bounding frontal rectangle that is solid. */
  frontalFill: 0.6,
} as const;

export const deriveDroneParams = (sizing: SizingResult, af: AirframeLike, o: MeasuredOverrides = {}): DroneParams => {
  const inp = sizing.input;
  const prop = { ...inp.prop, ct: o.ct ?? inp.prop.ct, cp: o.cp ?? inp.prop.cp };
  const motor = { ...inp.motor, timeConstant: o.motorTimeConstant ?? inp.motor.timeConstant };
  const mm = (v: number): number => v / 1000;
  const [cx, cy, cz] = af.cg;
  const rotors: RotorSpec[] = af.rotors.map((r) => ({ position: v3(mm(r.x - cx), mm(r.y - cy), mm(r.hubZ - cz)), spin: r.spin, motor, prop }));
  const massKg = (o.massG ?? af.massG) / 1000;
  const k = (o.inertiaScale ?? 1) * 1e-9 * (massKg / (af.massG / 1000));
  const I = af.inertia.map((v) => v * k) as DroneParams['inertia'];
  const bh = af.input.battery.size[2];
  const motorBottom = motorHeights(af.input).motorBottom;
  const lowest = Math.min(-bh, motorBottom);
  const top = af.rotors[0]?.hubZ ?? 0;
  const frontal = (af.input.pcb.h * (top - lowest) * AERO.frontalFill + af.rotors.length * af.input.motor.diameter * af.input.motor.length) * 1e-6;
  const arm = Math.hypot(af.rotors[0].x, af.rotors[0].y);
  return {
    name: 'Class A 設計機（段階2〜4 の設計値から導出）',
    mass: massKg,
    inertia: I,
    rotors,
    battery: inp.battery,
    dragArea: AERO.cd * frontal,
    rotorDrag: 0.02 * massKg * 10,
    collisionRadius: mm(arm) + inp.prop.diameter / 2,
    gearHeight: mm(cz - lowest),
    sensors: SENSORS_MICRO,
    gains: GAINS_DEFAULT,
    landCellVoltage: 3.3,
    physicsRateHz: 1000,
    controlRateHz: 500,
  };
};

export interface SensitivityCase {
  id: string;
  label: string;
  /** Build the "true" plant from the design model. */
  plant: (p: DroneParams) => DroneParams;
}

const withProp = (p: DroneParams, f: (r: RotorSpec) => RotorSpec): DroneParams => ({ ...p, rotors: p.rotors.map(f) });

export const SENSITIVITY_CASES: SensitivityCase[] = [
  { id: 'nominal', label: '設計どおり（プラント＝モデル）', plant: (p) => p },
  { id: 'ct-20', label: '推力係数 CT −20 %（プロペラ性能不足）', plant: (p) => withProp(p, (r) => ({ ...r, prop: { ...r.prop, ct: r.prop.ct * 0.8 } })) },
  { id: 'cp+20', label: 'パワー係数 CP +20 %（反トルク・負荷増）', plant: (p) => withProp(p, (r) => ({ ...r, prop: { ...r.prop, cp: r.prop.cp * 1.2 } })) },
  { id: 'tau2', label: 'モータ時定数 ×2（応答遅れ）', plant: (p) => withProp(p, (r) => ({ ...r, motor: { ...r.motor, timeConstant: r.motor.timeConstant * 2 } })) },
  { id: 'mass+10', label: '質量 +10 %（配線・接着剤・カメラ等）', plant: (p) => ({ ...p, mass: p.mass * 1.1, inertia: p.inertia.map((v) => v * 1.1) as DroneParams['inertia'] }) },
  { id: 'inertia1.5', label: '慣性 ×1.5（近似誤差）', plant: (p) => ({ ...p, inertia: p.inertia.map((v) => v * 1.5) as DroneParams['inertia'] }) },
  { id: 'cg3', label: '重心 3 mm 前方にずれ（電池位置ずれ）', plant: (p) => withProp(p, (r) => ({ ...r, position: v3(r.position.x - 0.003, r.position.y, r.position.z) })) },
  { id: 'motor-10', label: 'モータ 1 個だけ KV −10 %（個体差）', plant: (p) => ({ ...p, rotors: p.rotors.map((r, i) => (i === 0 ? { ...r, motor: { ...r.motor, kv: r.motor.kv * 0.9 } } : r)) }) },
  { id: 'battery-aged', label: '電池劣化（内部抵抗 ×2、容量 ×0.8）', plant: (p) => ({ ...p, battery: { ...p.battery, internalResistance: p.battery.internalResistance * 2, capacityAh: p.battery.capacityAh * 0.8 } }) },
];
