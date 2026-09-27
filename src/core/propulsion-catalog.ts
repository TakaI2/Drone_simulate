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

/**
 * Outdoor (variant C) candidates: bolt-on brushless micro motors, 1.5 mm-bore props and 2S/3S packs.
 * Kept separate so the Class A search (stage 2) is unchanged.
 */
export const MOTORS_OUTDOOR: MotorSpec[] = [
  { id: 'bl-1103-8000', name: 'Brushless 1103 8000KV', kind: 'brushless', kv: 8000, resistance: 0.33, noLoadCurrent: 0.2, timeConstant: 0.02, maxCurrent: 4, mass: g(3.6), diameter: mm(13.8), length: mm(9.5), shaftDiameter: mm(1.5), mountSpacing: mm(6.6) },
  { id: 'bl-1204-5000', name: 'Brushless 1204 5000KV', kind: 'brushless', kv: 5000, resistance: 0.2, noLoadCurrent: 0.3, timeConstant: 0.025, maxCurrent: 7, mass: g(6.5), diameter: mm(15.5), length: mm(12), shaftDiameter: mm(1.5), mountSpacing: mm(9) },
  { id: 'bl-1404-3800', name: 'Brushless 1404 3800KV', kind: 'brushless', kv: 3800, resistance: 0.18, noLoadCurrent: 0.35, timeConstant: 0.03, maxCurrent: 9, mass: g(9), diameter: mm(18), length: mm(13), shaftDiameter: mm(1.5), mountSpacing: mm(9) },
  { id: 'bl-1404-4600', name: 'Brushless 1404 4600KV', kind: 'brushless', kv: 4600, resistance: 0.14, noLoadCurrent: 0.4, timeConstant: 0.03, maxCurrent: 10, mass: g(9), diameter: mm(18), length: mm(13), shaftDiameter: mm(1.5), mountSpacing: mm(9) },
];

export const PROPS_OUTDOOR: PropSpec[] = [
  { id: 'prop-63-3b', name: '2.5 inch 3-blade (63mm)', diameter: mm(63), pitch: mm(38), blades: 3, ct: 0.12, cp: 0.065, mass: g(0.8), bore: mm(1.5) },
  { id: 'prop-76-2b', name: '3 inch 2-blade (76mm, 3018)', diameter: mm(76), pitch: mm(46), blades: 2, ct: 0.11, cp: 0.055, mass: g(1.1), bore: mm(1.5) },
  { id: 'prop-76-3b', name: '3 inch 3-blade (76mm, 3016)', diameter: mm(76), pitch: mm(40), blades: 3, ct: 0.13, cp: 0.07, mass: g(1.4), bore: mm(1.5) },
  { id: 'prop-90-2b', name: '3.5 inch 2-blade (90mm)', diameter: mm(90), pitch: mm(50), blades: 2, ct: 0.11, cp: 0.055, mass: g(1.6), bore: mm(1.5) },
];

const lipoPack = (cells: number, mah: number, grams: number, r: number, cRate: number, l: number, w: number, h: number): BatterySpec => ({
  id: `lipo-${cells}s-${mah}`,
  name: `LiPo ${cells}S ${mah}mAh`,
  cells,
  capacityAh: mah / 1000,
  internalResistance: r,
  mass: g(grams),
  cellVoltageMin: 3.3,
  cellVoltageNominal: 3.7,
  cellVoltageMax: 4.2,
  maxDischargeC: cRate,
  size: v3(mm(l), mm(w), mm(h)),
  connector: 'XT30',
});

export const BATTERIES_OUTDOOR: BatterySpec[] = [
  lipoPack(2, 300, 19, 0.08, 75, 45, 17, 13),
  lipoPack(2, 450, 26, 0.07, 75, 57, 18, 14),
  lipoPack(2, 550, 32, 0.06, 75, 60, 20, 15),
  lipoPack(3, 450, 38, 0.1, 75, 57, 18, 20),
];

export const findMotor = (id: string): MotorSpec => {
  const m = [...MOTORS, ...MOTORS_OUTDOOR].find((x) => x.id === id);
  if (!m) throw new Error(`Unknown motor ${id}`);
  return m;
};
export const findProp = (id: string): PropSpec => {
  const p = [...PROPS, ...PROPS_OUTDOOR].find((x) => x.id === id);
  if (!p) throw new Error(`Unknown prop ${id}`);
  return p;
};
export const findBattery = (id: string): BatterySpec => {
  const b = [...BATTERIES, ...BATTERIES_OUTDOOR].find((x) => x.id === id);
  if (!b) throw new Error(`Unknown battery ${id}`);
  return b;
};
