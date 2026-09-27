import { findPart } from './catalog';
import { buildNets } from './circuit';
import type { BlockId, Circuit, Component, PinDef } from './circuit';

/**
 * Variant B: optical-flow (PMW3901) + ToF (VL53L1X) sensor sub-board.
 * Connector pin order matches the main board's J2 so a straight 1:1 JST-SH cable is used.
 * Pin numbers of the two sensors follow the published pin lists as far as known and are flagged `verify` in the catalog.
 */

/** Sub-board outline and mounting (mm). Holes sit at both ends of the long (x) axis; the frame nose copies them. */
export const FLOW_BOARD = {
  /** Candidate outlines tried by the PCB pipeline, smallest first. */
  sizes: [[24, 20], [26, 20], [26, 22], [28, 22], [30, 24]] as Array<[number, number]>,
  holeEdgeInset: 2.0,
  /** Lens barrel on the flow sensor (mechanical, not on the PCB netlist). */
  lens: { mpn: 'LM19-LSI 相当', massG: 0.2, diameter: 5.5, height: 3.2 },
} as const;

/** Connector J1 on the rear (-y) edge centre, body flush with the edge so the cable leaves the board directly. */
export const flowBoardAnchors = (_w: number, h: number): Array<{ ref: string; x: number; y: number; rot: number }> => [
  { ref: 'J1', x: 0, y: -h / 2 + 3.6, rot: 0 },
];

export const flowBoardHoles = (w: number): Array<{ x: number; y: number }> => [
  { x: w / 2 - FLOW_BOARD.holeEdgeInset, y: 0 },
  { x: -(w / 2 - FLOW_BOARD.holeEdgeInset), y: 0 },
];

export const generateFlowBoard = (): Circuit => {
  const components: Component[] = [];
  const counters: Record<string, number> = {};
  const add = (prefix: string, partId: string, block: BlockId, pins: PinDef[], extra: Partial<Component> = {}): Component => {
    counters[prefix] = (counters[prefix] ?? 0) + 1;
    const part = findPart(partId);
    const c: Component = { ref: `${prefix}${counters[prefix]}`, partId, part, value: String(part.specs['抵抗値'] ?? part.specs['容量'] ?? part.mpn), block, pins, ...extra };
    components.push(c);
    return c;
  };
  const two = (a: string, b: string): PinDef[] => [{ num: '1', name: '1', net: a }, { num: '2', name: '2', net: b }];

  // connector (same order as main board J2)
  add('J', 'JST-SM08B-SRSS-TB', 'connectors', [
    { num: '1', name: '3V3', net: '3V3' },
    { num: '2', name: 'GND', net: 'GND' },
    { num: '3', name: 'SCK', net: 'SPI_SCK' },
    { num: '4', name: 'MOSI', net: 'SPI_MOSI' },
    { num: '5', name: 'MISO', net: 'SPI_MISO' },
    { num: '6', name: 'CS', net: 'FLOW_CS' },
    { num: '7', name: 'SDA', net: 'I2C_SDA' },
    { num: '8', name: 'SCL', net: 'I2C_SCL' },
    { num: 'MP1', name: 'MP', net: 'GND' },
    { num: 'MP2', name: 'MP', net: 'GND' },
  ]);
  // 1.8 V core supply for the flow sensor
  add('U', 'XC6206P182MR', 'power', [
    { num: '1', name: 'VSS', net: 'GND' },
    { num: '2', name: 'VOUT', net: '1V8' },
    { num: '3', name: 'VIN', net: '3V3' },
  ]);
  add('C', 'C0603-1u', 'power', two('3V3', 'GND'), { near: 'U1' });
  add('C', 'C0603-1u', 'power', two('1V8', 'GND'), { near: 'U1' });
  // optical flow sensor (20-pin, unused pins NC)
  const flowPins: Record<string, [string, string | null]> = {
    '1': ['VDD', '1V8'], '2': ['VDDIO', '3V3'], '3': ['GND', 'GND'], '4': ['NCS', 'FLOW_CS'], '5': ['MISO', 'SPI_MISO'],
    '6': ['SCLK', 'SPI_SCK'], '7': ['MOSI', 'SPI_MOSI'], '8': ['MOTION', null], '9': ['NRESET', 'FLOW_NRST'], '10': ['GND', 'GND'],
  };
  add('U', 'PMW3901MB-TXQT', 'sensors', Array.from({ length: 20 }, (_, i) => {
    const n = String(i + 1);
    const [name, net] = flowPins[n] ?? ['NC', null];
    return { num: n, name, net };
  }));
  add('C', 'C0603-100n', 'sensors', two('1V8', 'GND'), { near: 'U2' });
  add('C', 'C0603-100n', 'sensors', two('3V3', 'GND'), { near: 'U2' });
  add('R', 'R0603-10kΩ', 'sensors', two('3V3', 'FLOW_NRST'), { near: 'U2' });
  // ToF sensor
  add('U', 'VL53L1X', 'sensors', [
    { num: '1', name: 'AVDDVCSEL', net: '3V3' },
    { num: '2', name: 'AVSSVCSEL', net: 'GND' },
    { num: '3', name: 'GND', net: 'GND' },
    { num: '4', name: 'GND2', net: 'GND' },
    { num: '5', name: 'XSHUT', net: 'TOF_XSHUT' },
    { num: '6', name: 'GND3', net: 'GND' },
    { num: '7', name: 'GPIO1', net: null },
    { num: '8', name: 'DNC', net: null },
    { num: '9', name: 'SDA', net: 'I2C_SDA' },
    { num: '10', name: 'SCL', net: 'I2C_SCL' },
    { num: '11', name: 'AVDD', net: '3V3' },
    { num: '12', name: 'GND4', net: 'GND' },
  ]);
  add('C', 'C0603-100n', 'sensors', two('3V3', 'GND'), { near: 'U3' });
  add('C', 'C0805-10u', 'sensors', two('3V3', 'GND'), { near: 'U3' });
  add('R', 'R0603-10kΩ', 'sensors', two('3V3', 'TOF_XSHUT'), { near: 'U3' });
  // mounting
  add('H', 'MountHole-M2', 'mechanical', []);
  add('H', 'MountHole-M2', 'mechanical', []);

  return {
    name: 'センサ子基板（フロー＋ToF）',
    components,
    nets: buildNets(components),
    gpio: [
      { signal: 'フロー SPI', gpio: 'メイン J2 経由（IO12/IO11/IO13、CS=IO14）', note: 'PMW3901 は SPI 2 MHz 以下' },
      { signal: 'ToF I²C', gpio: 'メイン J2 経由（IO8/IO21）', note: 'I²C プルアップはメイン基板側（4.7 kΩ）' },
      { signal: 'NRESET / XSHUT', gpio: '子基板上でプルアップ', note: '常時有効（ピン節約）' },
    ],
  };
};
