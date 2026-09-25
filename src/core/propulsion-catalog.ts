import type { BatterySpec, MotorSpec, PropSpec } from './types';
import { v3 } from './math';

/**
 * Representative propulsion component data.
 * Values are typical figures compiled from common hobby-grade parts (generic, multi-vendor).
 * They MUST be refined by thrust-stand measurement before trusting absolute flight times.
 */

const g = (grams: number): number => grams / 1000;
const mm = (v: number): number => v / 1000;

export const MOTORS: MotorSpec[] = [
  { id: 'coreless-0615', name: 'Coreless 615 (6x15mm) brushed', kind: 'brushed', kv: 19000, resistance: 1.6, noLoadCurrent: 0.06, timeConstant: 0.025, maxCurrent: 1.2, mass: g(2.6), diameter: mm(6), length: mm(15), shaftDiameter: mm(0.8) },
  { id: 'coreless-0716', name: 'Coreless 716 (7x16mm) brushed', kind: 'brushed', kv: 16000, resistance: 1.1, noLoadCurrent: 0.07, timeConstant: 0.03, maxCurrent: 1.6, mass: g(3.3), diameter: mm(7), length: mm(16), shaftDiameter: mm(0.8) },
  { id: 'coreless-0820', name: 'Coreless 8520 (8.5x20mm) brushed', kind: 'brushed', kv: 12000, resistance: 0.65, noLoadCurrent: 0.1, timeConstant: 0.04, maxCurrent: 2.8, mass: g(5.0), diameter: mm(8.5), length: mm(20), shaftDiameter: mm(1.0) },
  { id: 'coreless-1020', name: 'Coreless 1020 (10x20mm) brushed', kind: 'brushed', kv: 11000, resistance: 0.45, noLoadCurrent: 0.15, timeConstant: 0.045, maxCurrent: 3.5, mass: g(7.0), diameter: mm(10), length: mm(20), shaftDiameter: mm(1.0), availability: 'limited' },
  { id: 'bl-1103-10000', name: 'Brushless 1103 10000KV', kind: 'brushless', kv: 10000, resistance: 0.25, noLoadCurrent: 0.25, timeConstant: 0.02, maxCurrent: 4, mass: g(3.8), diameter: mm(14), length: mm(10), shaftDiameter: mm(1.5), availability: 'limited' },
  { id: 'bl-2204-2300', name: 'Brushless 2204 2300KV', kind: 'brushless', kv: 2300, resistance: 0.11, noLoadCurrent: 0.6, timeConstant: 0.035, maxCurrent: 18, mass: g(25), diameter: mm(27.5), length: mm(17), shaftDiameter: mm(5) },
];

export const PROPS: PropSpec[] = [
  { id: 'prop-46', name: '46mm 2-blade', diameter: mm(46), pitch: mm(22), blades: 2, ct: 0.095, cp: 0.05, mass: g(0.25), bore: mm(0.8) },
  { id: 'prop-55', name: '55mm 2-blade', diameter: mm(55), pitch: mm(25), blades: 2, ct: 0.1, cp: 0.05, mass: g(0.35), bore: mm(0.8) },
  { id: 'prop-65', name: '65mm 2-blade', diameter: mm(65), pitch: mm(30), blades: 2, ct: 0.1, cp: 0.05, mass: g(0.5), bore: mm(1.0) },
  { id: 'prop-75', name: '75mm 2-blade', diameter: mm(75), pitch: mm(35), blades: 2, ct: 0.1, cp: 0.05, mass: g(0.7), bore: mm(1.0), availability: 'limited' },
  { id: 'prop-40-3b', name: '40mm 3-blade (whoop)', diameter: mm(40), pitch: mm(20), blades: 3, ct: 0.12, cp: 0.07, mass: g(0.3), bore: mm(1.5) },
  { id: 'prop-5045', name: '5045 2-blade (127mm)', diameter: mm(127), pitch: mm(114), blades: 2, ct: 0.11, cp: 0.055, mass: g(4), bore: mm(5) },
];

const lipo1s = (mah: number, grams: number, r: number, l: number, w: number, h: number): BatterySpec => ({
  id: `lipo-1s-${mah}`,
  name: `LiPo 1S ${mah}mAh`,
  cells: 1,
  capacityAh: mah / 1000,
  internalResistance: r,
  mass: g(grams),
  cellVoltageMin: 3.3,
  cellVoltageNominal: 3.7,
  cellVoltageMax: 4.2,
  maxDischargeC: 25,
  size: v3(mm(l), mm(w), mm(h)),
  connector: 'JST-PH 2.0',
});

export const BATTERIES: BatterySpec[] = [
  lipo1s(300, 8.0, 0.1, 40, 20, 6),
  lipo1s(450, 11.5, 0.08, 45, 25, 6),
  lipo1s(600, 15.0, 0.07, 50, 25, 7),
  lipo1s(800, 19.5, 0.06, 55, 30, 7),
  lipo1s(1000, 24.0, 0.05, 55, 30, 9),
  {
    id: 'lipo-3s-1300',
    name: 'LiPo 3S 1300mAh',
    cells: 3,
    capacityAh: 1.3,
    internalResistance: 0.03,
    mass: g(110),
    cellVoltageMin: 3.3,
    cellVoltageNominal: 3.7,
    cellVoltageMax: 4.2,
    maxDischargeC: 75,
    size: v3(mm(72), mm(35), mm(22)),
    connector: 'XT60',
  },
];

export const findMotor = (id: string): MotorSpec => {
  const m = MOTORS.find((x) => x.id === id);
  if (!m) throw new Error(`Unknown motor ${id}`);
  return m;
};
export const findProp = (id: string): PropSpec => {
  const p = PROPS.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown prop ${id}`);
  return p;
};
export const findBattery = (id: string): BatterySpec => {
  const b = BATTERIES.find((x) => x.id === id);
  if (!b) throw new Error(`Unknown battery ${id}`);
  return b;
};
