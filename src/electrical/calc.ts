import type { SizingResult } from '../sizing/propulsion';
import { findPart } from './catalog';
import type { Circuit } from './circuit';

/** Electrical design rules (assumptions documented in the report). */
export const ELECTRICAL_RULES = {
  gpioHigh: 3.3,
  /** ESP32-S3 GPIO absolute drive limit (conservative) [A]. */
  gpioMaxCurrent: 0.04,
  pwmFrequency: 20000,
  /** Board ambient during flight [°C]. */
  ambient: 40,
  maxJunctionRise: 50,
  currentMarginMin: 2,
  /** ESP32-S3 ADC upper usable input at 11/12 dB attenuation (conservative) [V]. */
  adcMax: 2.9,
  /** ESP32-S3 minimum supply [V]. */
  mcuVmin: 3.0,
  /** Current budget on 3.3 V rail [A]. */
  mcuPeak: 0.34,
  mcuAverage: 0.1,
  sensorsCurrent: 0.005,
  flowModuleCurrent: 0.03,
  ledCurrent: 0.003,
  /** Copper: 1 oz (35 um) outer layer, IPC-2221 external, allowed rise [°C]. */
  copperThicknessMil: 1.378,
  traceRise: 10,
  i2cBusCapacitance: 50e-12,
  i2cRiseMaxFast: 300e-9,
  /** MOSFET Rds(on) interpolated at Vgs = 3.3 V between 2.5 V and 4.5 V datasheet points. */
  gateDrive: 3.3,
  /** Effective SOT-23 thermal resistance with thermal copper pour [°C/W]. */
  sot23ThetaWithPour: 150,
  ldoThetaWithPour: 180,
} as const;

export interface CalcCheck {
  group: string;
  label: string;
  formula: string;
  value: number;
  unit: string;
  limit: number;
  op: 'lt' | 'gte';
  pass: boolean;
  note: string;
}

export interface ElectricalCalc {
  checks: CalcCheck[];
  derived: Record<string, number>;
  /** Recommended trace widths [mm]. */
  traceWidth: { signal: number; power3v3: number; motor: number; vbat: number };
  pass: boolean;
}

/** IPC-2221 external layer: I = 0.048 * dT^0.44 * A^0.725 (A in mil^2). Returns width in mm. */
export const ipc2221Width = (current: number, riseC: number, thicknessMil: number): number => {
  const area = Math.pow(current / (0.048 * Math.pow(riseC, 0.44)), 1 / 0.725);
  return (area / thicknessMil) * 0.0254;
};

export const computeElectrical = (circuit: Circuit, sizing: SizingResult): ElectricalCalc => {
  const R = ELECTRICAL_RULES;
  const checks: CalcCheck[] = [];
  const chk = (group: string, label: string, formula: string, value: number, unit: string, limit: number, op: 'lt' | 'gte', note = ''): void => {
    checks.push({ group, label, formula, value, unit, limit, op, pass: op === 'lt' ? value < limit : value >= limit, note });
  };
  const b = sizing.input.battery;
  const vmax = b.cells * b.cellVoltageMax;
  const vminLoad = b.cells * 3.3;
  const iMotorMax = sizing.max.motorCurrent;
  const iMotorHover = sizing.hover.motorCurrent;
  const uHover = sizing.hover.throttle;
  const iBattMax = sizing.max.batteryCurrent;

  // ---- MOSFET ----
  const q = findPart('AO3400A').specs;
  const rds25 = Number(q['Rds(on)@2.5V']), rds45 = Number(q['Rds(on)@4.5V']);
  const rds = rds25 + ((rds45 - rds25) * (R.gateDrive - 2.5)) / 2.0;
  const qg = 6e-9;
  const rGate = 47;
  const tSw = (qg * rGate) / R.gpioHigh;
  const pCondMax = iMotorMax * iMotorMax * rds;
  const pSw = 0.5 * vmax * iMotorMax * 2 * tSw * R.pwmFrequency;
  const dT = (pCondMax + pSw) * R.sot23ThetaWithPour;
  chk('モータ駆動 MOSFET', '電流余裕 Id / Imax', `${q['Id(連続)']} A / ${iMotorMax.toFixed(2)} A`, Number(q['Id(連続)']) / iMotorMax, '倍', R.currentMarginMin, 'gte');
  chk('モータ駆動 MOSFET', '耐圧余裕 Vds / Vbat,max', `${q.Vds} V / ${vmax.toFixed(1)} V`, Number(q.Vds) / vmax, '倍', R.currentMarginMin, 'gte');
  chk('モータ駆動 MOSFET', 'ゲート駆動 Vgs − Vgs(th)max', `${R.gpioHigh} − ${q['Vgs(th) max']}`, R.gpioHigh - Number(q['Vgs(th) max']), 'V', 1.0, 'gte', 'Rds(on) は 2.5 V と 4.5 V の規格値から 3.3 V を線形補間');
  chk('モータ駆動 MOSFET', '温度上昇（全開時）', `(I²·Rds + ½·V·I·2tsw·f)·θja = (${pCondMax.toFixed(3)} + ${pSw.toFixed(3)}) W × ${R.sot23ThetaWithPour} °C/W`, dT, '°C', R.maxJunctionRise, 'lt', 'ドレイン側に放熱銅箔＋サーマルビアを設ける前提の θja');
  // ---- gate resistor ----
  const iGatePeak = R.gpioHigh / rGate;
  chk('ゲート抵抗', 'GPIO ピーク電流 V/Rg', `${R.gpioHigh} V / ${rGate} Ω`, iGatePeak * 1000, 'mA', 80, 'lt', 'Qg≈6 nC を数十 ns で充電する過渡電流。平均電流は Qg·f≈0.1 mA と小さい');
  chk('ゲート抵抗', 'スイッチング時間 Qg·Rg/V', `6 nC × ${rGate} Ω / ${R.gpioHigh} V`, tSw * 1e9, 'ns', 0.01 / R.pwmFrequency * 1e9, 'lt', 'PWM 周期の 1 % 未満');
  chk('ゲート抵抗', 'プルダウン電流', `${R.gpioHigh} V / 10 kΩ`, (R.gpioHigh / 10000) * 1000, 'mA', 1, 'lt', '起動時に GPIO が浮いてもモータが回らないようにする');
  // ---- flyback diode ----
  const d = findPart('B5819W').specs;
  const iDiodeAvg = (1 - Math.min(1, uHover)) * iMotorHover;
  chk('還流ダイオード', '平均電流余裕 IF(AV) / ((1−u)·Im)', `${d['IF(AV)']} A / ${iDiodeAvg.toFixed(2)} A`, Number(d['IF(AV)']) / iDiodeAvg, '倍', 1.5, 'gte', 'ホバリング時の OFF 期間にモータ電流が還流');
  chk('還流ダイオード', 'サージ耐量 IFSM / Imax', `${d.IFSM} A / ${iMotorMax.toFixed(2)} A`, Number(d.IFSM) / iMotorMax, '倍', R.currentMarginMin, 'gte');
  chk('還流ダイオード', '逆耐圧 VRRM / Vbat,max', `${d.VRRM} V / ${vmax.toFixed(1)} V`, Number(d.VRRM) / vmax, '倍', R.currentMarginMin, 'gte');
  // ---- LDO ----
  const iLoadPeak = R.mcuPeak + R.sensorsCurrent + R.flowModuleCurrent + R.ledCurrent;
  const iLoadAvg = R.mcuAverage + R.sensorsCurrent + R.flowModuleCurrent + R.ledCurrent;
  const ldo = findPart('XC6220B331MR').specs;
  chk('3.3 V LDO', '電流余裕 Iout,max / Iピーク', `${ldo['最大出力電流']} A / ${iLoadPeak.toFixed(3)} A`, Number(ldo['最大出力電流']) / iLoadPeak, '倍', R.currentMarginMin, 'gte');
  const pLdo = (vmax - 3.3) * iLoadAvg;
  chk('3.3 V LDO', '温度上昇（平均負荷・満充電）', `(${vmax.toFixed(1)} − 3.3) V × ${iLoadAvg.toFixed(3)} A × ${R.ldoThetaWithPour} °C/W`, pLdo * R.ldoThetaWithPour, '°C', R.maxJunctionRise, 'lt');
  const dropout = 0.35 * (iLoadPeak / 0.6);
  const vOutAtEmpty = Math.min(3.3, vminLoad - dropout);
  chk('3.3 V LDO', '電池終止電圧でのマイコン電源', `min(3.3, ${vminLoad.toFixed(2)} − ${dropout.toFixed(2)})`, vOutAtEmpty, 'V', R.mcuVmin, 'gte', 'ドロップアウトは規格値から負荷電流に比例として推定。ブラウンアウト防止に 47 µF×2 のバルクを電池入力に置く');
  chk('3.3 V LDO', '入力電圧余裕 Vin,max(規格) / Vbat,max', `6.0 V / ${vmax.toFixed(1)} V`, 6.0 / vmax, '倍', 1.2, 'gte');
  // ---- battery monitor ----
  const ratio = 100 / (100 + 100);
  const vAdc = vmax * ratio;
  chk('電池電圧監視', '満充電時 ADC 入力', `${vmax.toFixed(1)} V × 100k/(100k+100k)`, vAdc, 'V', R.adcMax, 'lt');
  chk('電池電圧監視', '分圧器の消費電流', `${vmax.toFixed(1)} V / 200 kΩ`, (vmax / 200e3) * 1e6, 'µA', 50, 'lt');
  const tau = 50e3 * 100e-9;
  chk('電池電圧監視', 'RC 時定数（ノイズ除去）', '50 kΩ × 100 nF', tau * 1000, 'ms', 20, 'lt', '制御周期より十分長く、電圧降下の追従（数十 ms）には十分短い');
  // ---- I2C ----
  const tr = 0.8473 * 4700 * R.i2cBusCapacitance;
  chk('I²C', '立ち上がり時間 0.8473·Rp·Cb', `0.8473 × 4.7 kΩ × ${R.i2cBusCapacitance * 1e12} pF`, tr * 1e9, 'ns', R.i2cRiseMaxFast * 1e9, 'lt', 'Fast-mode（400 kHz）の上限 300 ns');
  // ---- LED ----
  chk('状態 LED', 'LED 電流 (3.3 − Vf)/R', '(3.3 − 2.0) V / 1 kΩ', 1.3, 'mA', 20, 'lt');
  // ---- connector ----
  chk('電池接続', '電池接続部の最大電流', `N × Imax = ${iBattMax.toFixed(1)} A`, iBattMax, 'A', 10, 'lt', '基板は 20 AWG リード直付けパッド。JST PH（2 A 定格）は不可');
  // ---- trace widths ----
  const wMotor = Math.max(0.5, ipc2221Width(iMotorMax, R.traceRise, R.copperThicknessMil));
  const wVbat = Math.max(1.0, ipc2221Width(iBattMax / 2, R.traceRise, R.copperThicknessMil));
  const w3v3 = Math.max(0.3, ipc2221Width(iLoadPeak, R.traceRise, R.copperThicknessMil));
  chk('配線幅（IPC-2221, 1 oz, ΔT 10 °C）', 'モータ配線に必要な幅', `I=${iMotorMax.toFixed(2)} A`, wMotor, 'mm', 2.0, 'lt', 'VBAT は両面ベタ（ポリゴン）で分担し、トレースは最大電流の半分で計算');
  // ---- netlist completeness ----
  const singles = circuit.nets.filter((n) => n.pins.length < 2);
  chk('ネットリスト', '接続先が 1 ピンしかないネット', singles.map((n) => n.name).join(', ') || 'なし', singles.length, '本', 1, 'lt');

  return {
    checks,
    derived: { rdsAt33: rds, tSwNs: tSw * 1e9, iLoadPeak, iLoadAvg, pLdo, vAdc, iBattMax, iMotorMax, iMotorHover },
    traceWidth: { signal: 0.2, power3v3: +w3v3.toFixed(2), motor: +wMotor.toFixed(2), vbat: +wVbat.toFixed(2) },
    pass: checks.every((c) => c.pass),
  };
};
