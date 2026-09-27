import { findPart } from './catalog';
import type { PartRecord } from './catalog';

export type NetClass = 'signal' | 'power' | 'motor' | 'gnd';

export interface PinDef {
  num: string;
  name: string;
  /** Net name, or null for intentionally unconnected (NC). */
  net: string | null;
}

export interface Component {
  ref: string;
  partId: string;
  part: PartRecord;
  value: string;
  block: BlockId;
  pins: PinDef[];
  /** Logical role used by the placer (e.g. which motor driver). */
  group?: string;
  /** Pins that dissipate heat (get thermal copper + vias on the PCB). */
  thermalPins?: string[];
  /** Placement hint: keep close to this component (decoupling, local support parts). */
  near?: string;
}

export interface Net {
  name: string;
  cls: NetClass;
  pins: Array<{ ref: string; pin: string }>;
}

export type BlockId = 'power' | 'mcu' | 'sensors' | 'motors' | 'monitor' | 'connectors' | 'mechanical';

export const BLOCK_TITLES: Record<BlockId, string> = {
  power: '電源（電池入力・3.3 V）',
  mcu: 'マイコン（ESP32-S3）',
  sensors: 'センサ（IMU・気圧・フロー/ToF）',
  motors: 'モータ駆動',
  monitor: '電池監視・表示',
  connectors: '書込み・操作',
  mechanical: '機構',
};

export interface Circuit {
  name: string;
  components: Component[];
  nets: Net[];
  /** GPIO assignment table (for firmware). */
  gpio: Array<{ signal: string; gpio: string; note: string }>;
}

export interface CircuitOptions {
  rotorCount: number;
  /** Variant B: JST-SH 6 for an external GNSS + compass module (UART1 + shared I2C). */
  gnssConnector?: boolean;
}

/** GNSS UART pins (free on ESP32-S3-WROOM-1-N8, not strapping, not used by PSRAM on N8). */
export const GNSS_GPIO = { tx: 'IO47', rx: 'IO48' } as const;

const classOfNet = (name: string): NetClass =>
  name === 'GND' ? 'gnd' : name === 'VBAT' || name === '3V3' || name === '1V8' ? 'power' : name.startsWith('MOT') ? 'motor' : 'signal';

/** Collect nets from component pins. */
export const buildNets = (components: Component[]): Net[] => {
  const netMap = new Map<string, Net>();
  for (const c of components)
    for (const p of c.pins) {
      if (!p.net) continue;
      if (!netMap.has(p.net)) netMap.set(p.net, { name: p.net, cls: classOfNet(p.net), pins: [] });
      netMap.get(p.net)!.pins.push({ ref: c.ref, pin: p.num });
    }
  return [...netMap.values()];
};

/** ESP32-S3-WROOM-1 module pin map (datasheet pin number -> name). */
export const WROOM1_PINS: Array<[string, string]> = [
  ['1', 'GND'], ['2', '3V3'], ['3', 'EN'], ['4', 'IO4'], ['5', 'IO5'], ['6', 'IO6'], ['7', 'IO7'], ['8', 'IO15'],
  ['9', 'IO16'], ['10', 'IO17'], ['11', 'IO18'], ['12', 'IO8'], ['13', 'IO19'], ['14', 'IO20'], ['15', 'IO3'],
  ['16', 'IO46'], ['17', 'IO9'], ['18', 'IO10'], ['19', 'IO11'], ['20', 'IO12'], ['21', 'IO13'], ['22', 'IO14'],
  ['23', 'IO21'], ['24', 'IO47'], ['25', 'IO48'], ['26', 'IO45'], ['27', 'IO0'], ['28', 'IO35'], ['29', 'IO36'],
  ['30', 'IO37'], ['31', 'IO38'], ['32', 'IO39'], ['33', 'IO40'], ['34', 'IO41'], ['35', 'IO42'], ['36', 'RXD0'],
  ['37', 'TXD0'], ['38', 'IO2'], ['39', 'IO1'], ['40', 'GND'], ['41', 'EPAD'],
];

/** Motor PWM GPIOs (LEDC capable, not strapping pins). Up to 8 rotors. */
const MOTOR_GPIOS = ['IO4', 'IO5', 'IO6', 'IO7', 'IO15', 'IO16', 'IO17', 'IO18'];

export const generateCircuit = (o: CircuitOptions): Circuit => {
  if (o.rotorCount > MOTOR_GPIOS.length - 2) throw new Error(`ロータ数 ${o.rotorCount} は GPIO 割当ての上限を超えています`);
  const components: Component[] = [];
  const counters: Record<string, number> = {};
  const nextRef = (prefix: string): string => {
    counters[prefix] = (counters[prefix] ?? 0) + 1;
    return `${prefix}${counters[prefix]}`;
  };
  const add = (prefix: string, partId: string, block: BlockId, pins: PinDef[], extra: Partial<Component> = {}): Component => {
    const part = findPart(partId);
    const c: Component = { ref: nextRef(prefix), partId, part, value: String(part.specs['抵抗値'] ?? part.specs['容量'] ?? part.mpn), block, pins, ...extra };
    components.push(c);
    return c;
  };
  const two = (a: string | null, b: string | null): PinDef[] => [
    { num: '1', name: '1', net: a },
    { num: '2', name: '2', net: b },
  ];

  // ---------------- power ----------------
  add('J', 'BatteryPad', 'power', [{ num: '1', name: 'BAT+', net: 'VBAT' }, { num: '2', name: 'BAT-', net: 'GND' }]);
  add('C', 'C1206-47u', 'power', two('VBAT', 'GND'), { near: 'J1' });
  add('C', 'C1206-47u', 'power', two('VBAT', 'GND'), { near: 'J1' });
  add('U', 'XC6220B331MR', 'power', [
    { num: '1', name: 'VIN', net: 'VBAT' },
    { num: '2', name: 'VSS', net: 'GND' },
    { num: '3', name: 'CE', net: 'VBAT' },
    { num: '4', name: 'NC', net: null },
    { num: '5', name: 'VOUT', net: '3V3' },
  ], { thermalPins: ['2'], near: 'J1' });
  add('C', 'C0603-1u', 'power', two('VBAT', 'GND'), { near: 'U1' });
  add('C', 'C0805-10u', 'power', two('3V3', 'GND'), { near: 'U1' });

  // ---------------- MCU ----------------
  const motorNet = (i: number): string => `PWM${i + 1}`;
  const gpioNet: Record<string, string> = {
    GND: 'GND', '3V3': '3V3', EN: 'EN', IO0: 'BOOT', TXD0: 'TXD0', RXD0: 'RXD0',
    IO12: 'SPI_SCK', IO11: 'SPI_MOSI', IO13: 'SPI_MISO', IO10: 'IMU_CS', IO9: 'IMU_INT', IO14: 'FLOW_CS',
    IO8: 'I2C_SDA', IO21: 'I2C_SCL', IO1: 'VBAT_SENSE', IO2: 'LED', EPAD: 'GND',
  };
  for (let i = 0; i < o.rotorCount; i++) gpioNet[MOTOR_GPIOS[i]] = motorNet(i);
  if (o.gnssConnector) {
    gpioNet[GNSS_GPIO.tx] = 'GNSS_TX';
    gpioNet[GNSS_GPIO.rx] = 'GNSS_RX';
  }
  add('U', 'ESP32-S3-WROOM-1-N8', 'mcu', WROOM1_PINS.map(([num, name]) => ({ num, name, net: gpioNet[name] ?? null })));
  add('C', 'C0805-10u', 'mcu', two('3V3', 'GND'), { near: 'U2' });
  add('C', 'C0603-100n', 'mcu', two('3V3', 'GND'), { near: 'U2' });
  add('R', 'R0603-10kΩ', 'mcu', two('3V3', 'EN'), { near: 'U2' });
  add('C', 'C0603-1u', 'mcu', two('EN', 'GND'), { near: 'U2' });
  add('R', 'R0603-10kΩ', 'mcu', two('3V3', 'BOOT'), { near: 'U2' });

  // ---------------- sensors ----------------
  add('U', 'ICM-42688-P', 'sensors', [
    { num: '1', name: 'AP_SDO', net: 'SPI_MISO' },
    { num: '2', name: 'RESV', net: null },
    { num: '3', name: 'RESV', net: null },
    { num: '4', name: 'INT1', net: 'IMU_INT' },
    { num: '5', name: 'VDDIO', net: '3V3' },
    { num: '6', name: 'GND', net: 'GND' },
    { num: '7', name: 'RESV', net: null },
    { num: '8', name: 'VDD', net: '3V3' },
    { num: '9', name: 'INT2', net: null },
    { num: '10', name: 'RESV', net: null },
    { num: '11', name: 'RESV', net: null },
    { num: '12', name: 'AP_CS', net: 'IMU_CS' },
    { num: '13', name: 'AP_SCLK', net: 'SPI_SCK' },
    { num: '14', name: 'AP_SDI', net: 'SPI_MOSI' },
  ]);
  add('C', 'C0603-100n', 'sensors', two('3V3', 'GND'), { near: 'U3' });
  add('C', 'C0603-100n', 'sensors', two('3V3', 'GND'), { near: 'U3' });
  add('U', 'BMP390', 'sensors', [
    { num: '1', name: 'VDDIO', net: '3V3' },
    { num: '2', name: 'SCK', net: 'I2C_SCL' },
    { num: '3', name: 'VSS', net: 'GND' },
    { num: '4', name: 'SDI', net: 'I2C_SDA' },
    { num: '5', name: 'SDO', net: 'GND' },
    { num: '6', name: 'CSB', net: '3V3' },
    { num: '7', name: 'INT', net: null },
    { num: '8', name: 'VSS', net: 'GND' },
    { num: '9', name: 'VSS', net: 'GND' },
    { num: '10', name: 'VDD', net: '3V3' },
  ]);
  add('C', 'C0603-100n', 'sensors', two('3V3', 'GND'), { near: 'U4' });
  add('R', 'R0603-4.7kΩ', 'sensors', two('3V3', 'I2C_SDA'), { near: 'U4' });
  add('R', 'R0603-4.7kΩ', 'sensors', two('3V3', 'I2C_SCL'), { near: 'U4' });
  add('J', 'JST-SM08B-SRSS-TB', 'sensors', [
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

  // ---------------- motor drivers ----------------
  for (let i = 0; i < o.rotorCount; i++) {
    const g = `M${i + 1}`;
    const qRef = `Q${(counters.Q ?? 0) + 1}`;
    const padRef = `J${(counters.J ?? 0) + 1}`;
    add('R', 'R0603-47Ω', 'motors', two(motorNet(i), `GATE${i + 1}`), { group: g, near: qRef });
    add('R', 'R0603-10kΩ', 'motors', two(`GATE${i + 1}`, 'GND'), { group: g, near: qRef });
    add('Q', 'AO3400A', 'motors', [
      { num: '1', name: 'G', net: `GATE${i + 1}` },
      { num: '2', name: 'S', net: 'GND' },
      { num: '3', name: 'D', net: `MOT${i + 1}-` },
    ], { group: g, thermalPins: ['3'], near: padRef });
    add('D', 'B5819W', 'motors', [
      { num: '1', name: 'K', net: 'VBAT' },
      { num: '2', name: 'A', net: `MOT${i + 1}-` },
    ], { group: g, near: padRef });
    add('J', 'MotorPad', 'motors', [
      { num: '1', name: 'M+', net: 'VBAT' },
      { num: '2', name: 'M-', net: `MOT${i + 1}-` },
    ], { group: g });
  }

  // ---------------- monitor ----------------
  add('R', 'R0603-100kΩ', 'monitor', two('VBAT', 'VBAT_SENSE'));
  add('R', 'R0603-100kΩ', 'monitor', two('VBAT_SENSE', 'GND'));
  add('C', 'C0603-100n', 'monitor', two('VBAT_SENSE', 'GND'));
  add('R', 'R0603-1kΩ', 'monitor', two('LED', 'LED_A'), { near: 'U2' });
  add('D', 'LED0603-R', 'monitor', [
    { num: '1', name: 'K', net: 'GND' },
    { num: '2', name: 'A', net: 'LED_A' },
  ]);

  // ---------------- programming / buttons ----------------
  add('J', 'PinHeader-1x6', 'connectors', [
    { num: '1', name: '3V3', net: '3V3' },
    { num: '2', name: 'GND', net: 'GND' },
    { num: '3', name: 'TX', net: 'TXD0' },
    { num: '4', name: 'RX', net: 'RXD0' },
    { num: '5', name: 'EN', net: 'EN' },
    { num: '6', name: 'IO0', net: 'BOOT' },
  ]);
  add('SW', 'Tact-3x4', 'connectors', [
    { num: '1', name: '1', net: 'EN' },
    { num: '2', name: '2', net: 'GND' },
  ]);
  add('SW', 'Tact-3x4', 'connectors', [
    { num: '1', name: '1', net: 'BOOT' },
    { num: '2', name: '2', net: 'GND' },
  ]);
  if (o.gnssConnector) {
    // pinout follows the common flight-controller GPS port order (3V3/GND/TX/RX/SDA/SCL)
    add('J', 'JST-SM06B-SRSS-TB', 'connectors', [
      { num: '1', name: '3V3', net: '3V3' },
      { num: '2', name: 'GND', net: 'GND' },
      { num: '3', name: 'TX', net: 'GNSS_TX' },
      { num: '4', name: 'RX', net: 'GNSS_RX' },
      { num: '5', name: 'SDA', net: 'I2C_SDA' },
      { num: '6', name: 'SCL', net: 'I2C_SCL' },
      { num: 'MP1', name: 'MP', net: 'GND' },
      { num: 'MP2', name: 'MP', net: 'GND' },
    ]);
  }

  // ---------------- mechanical ----------------
  for (let i = 0; i < 4; i++) add('H', 'MountHole-M2', 'mechanical', []);

  // ---------------- nets ----------------
  const nets = buildNets(components);

  const gpio = [
    ...Array.from({ length: o.rotorCount }, (_, i) => ({ signal: `モータ ${i + 1} PWM`, gpio: MOTOR_GPIOS[i], note: 'LEDC 20 kHz 推奨（可聴域外）' })),
    { signal: 'SPI SCK', gpio: 'IO12', note: 'IMU とフローセンサで共用' },
    { signal: 'SPI MOSI', gpio: 'IO11', note: '' },
    { signal: 'SPI MISO', gpio: 'IO13', note: '' },
    { signal: 'IMU CS', gpio: 'IO10', note: '' },
    { signal: 'IMU INT1', gpio: 'IO9', note: 'データレディ割込み' },
    { signal: 'フロー CS', gpio: 'IO14', note: '' },
    { signal: 'I²C SDA', gpio: 'IO8', note: '気圧センサ・ToF' },
    { signal: 'I²C SCL', gpio: 'IO21', note: '' },
    { signal: '電池電圧', gpio: 'IO1', note: 'ADC1_CH0（Wi-Fi 使用中も読める ADC1 を使用）' },
    { signal: '状態 LED', gpio: 'IO2', note: '' },
    { signal: 'UART0 TX/RX', gpio: 'IO43 / IO44', note: '書込み・ログ' },
    ...(o.gnssConnector ? [{ signal: 'GNSS UART1 TX / RX', gpio: `${GNSS_GPIO.tx} / ${GNSS_GPIO.rx}`, note: 'J8（GNSS＋コンパス）。コンパスは I²C 共用' }] : []),
  ];

  const name = `Class A フライトコントローラ（${o.rotorCount} ロータ${o.gnssConnector ? '、GNSS 端子付き' : ''}）`;
  return { name, components, nets, gpio };
};
