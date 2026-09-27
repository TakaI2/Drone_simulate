import type { SizingResult } from '../sizing/propulsion';
import { ELECTRICAL_RULES, ipc2221Width } from './calc';
import type { CalcCheck, ElectricalCalc } from './calc';
import { findPart } from './catalog';
import { BUCK_FEEDBACK, VBAT_DIVIDER } from './circuit';
import type { Circuit } from './circuit';

/** Additional rules for the variant C power stage (assumptions documented in the report). */
export const ESC_RULES = {
  /** GNSS receiver + compass on the 3.3 V rail [A]. */
  gnssCurrent: 0.03,
  /** Step-down efficiency at light load (datasheet curves, conservative). */
  buckEfficiency: 0.8,
  /** SOT-23-6 with a GND pour [°C/W]. */
  sot236Theta: 160,
  /** Diode forward drop at light load [V]. */
  diodeVf: 0.35,
  /** ESP32-S3 supply range [V]. */
  mcuVmax: 3.6,
  /** Required ESC continuous current margin vs. max motor current. */
  escCurrentMargin: 1.5,
  /** Voltage margin of the regulator / ESC vs. the highest supported pack. */
  voltageMargin: 1.2,
  /** Highest pack the board is rated for (the ESC harness may be moved to a 3S/4S build). */
  maxCells: 4,
  adcBits: 12,
  /** Resolution goal of the battery voltage reading [V]. */
  vbatResolution: 0.02,
  /** Duty limit of the non-synchronous buck (min. off time) used for the dropout estimate. */
  maxDuty: 0.9,
  /** JST-SH per-contact rating [A]. */
  shContactRating: 1.0,
  /** DShot high-level input threshold of a 3.3 V ESC MCU (VIH ~0.7 VDD) [V]. */
  escVih: 2.31,
} as const;

/** Electrical checks for the variant C board (step-down supply, ESC harness). */
export const computeElectricalEsc = (circuit: Circuit, sizing: SizingResult): ElectricalCalc => {
  const R = ELECTRICAL_RULES;
  const E = ESC_RULES;
  const checks: CalcCheck[] = [];
  const chk = (group: string, label: string, formula: string, value: number, unit: string, limit: number, op: 'lt' | 'gte', note = ''): void => {
    checks.push({ group, label, formula, value, unit, limit, op, pass: op === 'lt' ? value < limit : value >= limit, note });
  };
  const b = sizing.input.battery;
  const vmax = b.cells * b.cellVoltageMax;
  const vmaxRated = E.maxCells * b.cellVoltageMax;
  const vminLoad = b.cells * b.cellVoltageMin;
  const iMotorMax = sizing.max.motorCurrent;
  const iBattMax = sizing.max.batteryCurrent;

  // ---- step-down regulator ----
  const buck = findPart('MP2359DJ').specs;
  const vfb = Number(buck['帰還電圧']);
  const vout = vfb * (1 + BUCK_FEEDBACK.top / BUCK_FEEDBACK.bottom);
  const iLoadPeak = R.mcuPeak + R.sensorsCurrent + E.gnssCurrent + R.ledCurrent;
  const iLoadAvg = R.mcuAverage + R.sensorsCurrent + E.gnssCurrent + R.ledCurrent;
  chk('3.3 V 降圧 DC-DC', '入力耐圧余裕 Vin,max(規格) / 4S 満充電', `${buck['最大入力']} V / ${vmaxRated.toFixed(1)} V`, Number(buck['最大入力']) / vmaxRated, '倍', E.voltageMargin, 'gte', '2S で設計し、3S/4S の ESC ハーネスにも付け替えられるよう 4S を上限とする');
  const vinNeed = Math.max(Number(buck['最小入力']), vout / E.maxDuty + 0.3);
  chk('3.3 V 降圧 DC-DC', '電池終止電圧での入力余裕 Vbat,min / Vin,need', `${vminLoad.toFixed(2)} V / max(${buck['最小入力']}, Vout/Dmax+0.3) V`, vminLoad / vinNeed, '倍', 1.1, 'gte', `${b.cells}S の終止電圧 ${b.cellVoltageMin} V/セル。1S 電池では使えない`);
  chk('3.3 V 降圧 DC-DC', '出力電圧（下限） Vfb·(1+Rt/Rb)', `${vfb} × (1 + ${BUCK_FEEDBACK.top / 1e3}k / ${BUCK_FEEDBACK.bottom / 1e3}k)`, vout, 'V', R.mcuVmin, 'gte', 'E12 系列の 33 kΩ で 3.26 V（ESP32-S3 の推奨 3.0〜3.6 V）');
  chk('3.3 V 降圧 DC-DC', '出力電圧（上限）', 'ESP32-S3 の最大電源電圧', vout, 'V', E.mcuVmax, 'lt');
  chk('3.3 V 降圧 DC-DC', '電流余裕 Iout,max / Iピーク', `${buck['最大出力電流']} A / ${iLoadPeak.toFixed(3)} A`, Number(buck['最大出力電流']) / iLoadPeak, '倍', R.currentMarginMin, 'gte', 'Wi-Fi 送信ピーク＋センサ＋GNSS');
  const pOut = vout * iLoadAvg;
  const pLoss = pOut * (1 / E.buckEfficiency - 1);
  const duty = vout / vmax;
  const pDiode = E.diodeVf * iLoadAvg * (1 - duty);
  const pIc = Math.max(0, pLoss - pDiode);
  chk('3.3 V 降圧 DC-DC', 'IC の温度上昇（平均負荷・満充電）', `(Pout(1/η−1) − P_D) × θja = ${pIc.toFixed(3)} W × ${E.sot236Theta} °C/W`, pIc * E.sot236Theta, '°C', R.maxJunctionRise, 'lt', `η=${E.buckEfficiency}（軽負荷の控えめな値）。LDO なら (Vbat−3.3)·I の損失で ${((vmax - 3.3) * iLoadAvg * R.ldoThetaWithPour).toFixed(0)} °C 上昇、入力耐圧も不足`);
  // ---- inductor / diode ----
  const L = 10e-6;
  const fsw = Number(buck['スイッチング周波数']);
  const ripple = ((vmax - vout) * vout) / (vmax * L * fsw);
  const lPart = findPart('L-10u-4020').specs;
  chk('インダクタ', '飽和電流余裕 Isat / (Iピーク + ΔI/2)', `${lPart['飽和電流']} A / (${iLoadPeak.toFixed(2)} + ${(ripple / 2).toFixed(3)}) A`, Number(lPart['飽和電流']) / (iLoadPeak + ripple / 2), '倍', 1.5, 'gte', `ΔI = (Vin−Vout)·Vout/(Vin·L·f) = ${(ripple * 1000).toFixed(0)} mA（L=10 µH, f=${(fsw / 1e6).toFixed(1)} MHz）`);
  const d = findPart('B5819W').specs;
  chk('整流ダイオード', '逆耐圧 VRRM / 4S 満充電', `${d.VRRM} V / ${vmaxRated.toFixed(1)} V`, Number(d.VRRM) / vmaxRated, '倍', E.voltageMargin, 'gte');
  chk('整流ダイオード', '平均電流余裕 IF(AV) / Iピーク', `${d['IF(AV)']} A / ${iLoadPeak.toFixed(2)} A`, Number(d['IF(AV)']) / iLoadPeak, '倍', R.currentMarginMin, 'gte');
  const cin = findPart('C0805-10u-25V').specs;
  chk('入力コンデンサ', '定格電圧余裕 / 4S 満充電', `${cin['定格電圧']} / ${vmaxRated.toFixed(1)} V`, parseFloat(String(cin['定格電圧'])) / vmaxRated, '倍', 1.4, 'gte', 'X5R の DC バイアスによる容量低下を見込み 1.4 倍以上');
  // ---- battery monitor ----
  const div = VBAT_DIVIDER.buck;
  const ratio = div.bottom / (div.top + div.bottom);
  chk('電池電圧監視', '4S 満充電時 ADC 入力', `${vmaxRated.toFixed(1)} V × ${div.bottom / 1e3}k/(${div.top / 1e3}k+${div.bottom / 1e3}k)`, vmaxRated * ratio, 'V', R.adcMax, 'lt');
  const lsb = R.adcMax / 2 ** E.adcBits / ratio;
  chk('電池電圧監視', '電池電圧の分解能', `${R.adcMax} V / 2^${E.adcBits} / 分圧比`, lsb * 1000, 'mV', E.vbatResolution * 1000, 'lt', 'セル電圧 3.3 V の着陸判定に十分');
  const tau = ((div.top * div.bottom) / (div.top + div.bottom)) * 100e-9;
  chk('電池電圧監視', 'RC 時定数（ノイズ除去）', `(${div.top / 1e3}k ∥ ${div.bottom / 1e3}k) × 100 nF`, tau * 1000, 'ms', 20, 'lt');
  // ---- ESC ----
  const esc = findPart('ESC-4in1-AM32').specs;
  chk('4-in-1 ESC（市販）', '連続電流余裕 / モータ最大電流', `${esc['連続電流']} A / ${iMotorMax.toFixed(2)} A`, Number(esc['連続電流']) / iMotorMax, '倍', E.escCurrentMargin, 'gte', 'ブラシレスは突入・加速時にピーク電流が出るため 1.5 倍以上');
  chk('4-in-1 ESC（市販）', '耐圧余裕 / 電池満充電', `${esc['最大電圧']} V / ${vmax.toFixed(1)} V`, Number(esc['最大電圧']) / vmax, '倍', E.voltageMargin, 'gte');
  chk('4-in-1 ESC（市販）', 'DShot 信号の High レベル余裕', `${R.gpioHigh} V − VIH ${E.escVih} V`, R.gpioHigh - E.escVih, 'V', 0.5, 'gte', 'AM32 の ESC は 3.3 V 系マイコン。5 V 系の ESC でも 3.3 V 信号で動作するものが多いが要確認');
  chk('電池接続', '電池の最大放電電流 / 許容', `${iBattMax.toFixed(1)} A / (${b.maxDischargeC} C × ${b.capacityAh} Ah)`, iBattMax / (b.maxDischargeC * b.capacityAh), '倍', 1, 'lt', `XT30（定格 15 A 程度）で ESC に直結。FC には ESC ハーネス経由で給電`);
  const iFcIn = (vout * iLoadPeak) / E.buckEfficiency / vminLoad;
  chk('ESC ハーネス', 'FC 給電ピンの電流', `Vout·Iピーク/η/Vbat,min`, iFcIn, 'A', E.shContactRating, 'lt', 'JST-SH 1 接点 1 A 定格');
  // ---- I2C / LED (same as variant A) ----
  const tr = 0.8473 * 4700 * R.i2cBusCapacitance;
  chk('I²C', '立ち上がり時間 0.8473·Rp·Cb', `0.8473 × 4.7 kΩ × ${R.i2cBusCapacitance * 1e12} pF`, tr * 1e9, 'ns', R.i2cRiseMaxFast * 1e9, 'lt', 'GNSS のコンパスも同じバスに載る（配線長に注意）');
  chk('状態 LED', 'LED 電流 (3.3 − Vf)/R', '(3.3 − 2.0) V / 1 kΩ', 1.3, 'mA', 20, 'lt');
  // ---- netlist ----
  const singles = circuit.nets.filter((n) => n.pins.length < 2);
  chk('ネットリスト', '接続先が 1 ピンしかないネット', singles.map((n) => n.name).join(', ') || 'なし', singles.length, '本', 1, 'lt');
  const w3v3 = Math.max(0.3, ipc2221Width(iLoadPeak, R.traceRise, R.copperThicknessMil));
  const wVbat = Math.max(0.4, ipc2221Width(iFcIn, R.traceRise, R.copperThicknessMil));
  return {
    checks,
    derived: { vout, iLoadPeak, iLoadAvg, pLoss, ripple, iFcIn, iBattMax, iMotorMax, vAdc: vmaxRated * ratio },
    traceWidth: { signal: 0.2, power3v3: +w3v3.toFixed(2), motor: 0, vbat: +wVbat.toFixed(2) },
    pass: checks.every((c) => c.pass),
  };
};
