import { vendorLinks } from '../electrical/catalog';
import type { Stage2Result } from '../integration/stage2';
import { throttleCurve } from '../sizing/propulsion';
import type { SizingResult } from '../sizing/propulsion';
import { lineChartSvg } from './chart';
import { esc, statusPill, table } from './html';

const f = (v: number, d = 2): string => (Number.isFinite(v) ? v.toFixed(d) : '—');

export const sizingSummaryHtml = (s: SizingResult): string => {
  const i = s.input;
  return table(
    ['項目', '値', '備考'],
    [
      ['構成', esc(`${i.rotorCount} ロータ / ${i.motor.name} / ${i.prop.name} / ${i.battery.name}`), ''],
      ['腕長（ハブ中心距離）', `${f(s.armLength * 1000, 1)} mm`, `隣接プロペラ間隙 10 mm で決定。対角ホイールベース ${f(s.wheelbase * 1000, 0)} mm`],
      ['全備重量', `${f(s.auw * 1000, 1)} g`, '100 g 未満＝模型航空機（航空法の無人航空機登録の対象外）'],
      ['推力係数 kT / トルク係数 kQ', `${s.kT.toExponential(3)} / ${s.kQ.toExponential(3)}`, 'ω[rad/s] 基準。CT・CP は代表値（要実測）'],
      ['ホバリング回転数', `${f(s.hover.rpm, 0)} rpm`, ''],
      ['ホバリングスロットル', `${f(s.hover.throttle * 100, 1)} %`, '60 % 以下が目安（制御余裕）'],
      ['ホバリング電流（電池）', `${f(s.hover.batteryCurrent)} A`, `電池電圧 ${f(s.hover.batteryVoltage)} V（SoC 50 %、内部抵抗込み）`],
      ['最大推力（1 ロータ）', `${f((s.max.thrustPerRotor / 9.80665) * 1000, 1)} gf`, `全開時の電池電流 ${f(s.max.batteryCurrent, 1)} A`],
      ['推力重量比 TWR', f(s.twr), '2.0 以上が目安（外乱・機動の余裕）'],
      ['推定ホバリング飛行時間', `${f(s.flightTimeMin, 1)} 分`, '使用可能容量 80 % で計算。実機は 2〜4 割短くなりうる'],
      ['円盤荷重', `${f(s.discLoading, 1)} N/m²`, ''],
      ['性能指数 FoM（運動量理論）', f(s.figureOfMerit), `理想パワー ${f(s.idealHoverPowerPerRotor)} W / 軸出力 ${f(s.hover.mechanicalPowerPerRotor)} W（1 ロータ）`],
      ['最大放電レート', `${f(s.maxBatteryC, 1)} C`, `電池の定格 ${i.battery.maxDischargeC} C`],
    ],
  );
};

export const massTableHtml = (s: SizingResult): string =>
  table(
    ['部位', '質量 [g]', '割合'],
    [...s.massBreakdown.map((m) => [esc(m.item), f(m.mass * 1000, 1), `${f((m.mass / s.auw) * 100, 1)} %`]), ['<b>合計</b>', `<b>${f(s.auw * 1000, 1)}</b>`, '100 %']],
  );

export const sizingChecksHtml = (s: SizingResult): string =>
  table(
    ['検証項目', '値', '基準', '判定'],
    s.checks.map((c) => [esc(c.label), `${f(c.value)} ${c.unit}`, `${c.op === 'lt' ? '<' : '≥'} ${c.limit} ${c.unit}`, statusPill(c.pass)]),
  );

export const searchTableHtml = (r: Stage2Result, limit = 15): string => {
  const rows = [...r.search.all].sort((a, b) => Number(b.feasible) - Number(a.feasible) || b.flightTimeMin - a.flightTimeMin).slice(0, limit);
  return table(
    ['モータ', 'プロペラ', '電池', '全備重量 [g]', 'TWR', 'ホバ. スロットル', '飛行時間 [分]', '入手性', '判定', '不合格理由'],
    rows.map((x) => [
      esc(x.input.motor.id), esc(x.input.prop.id), esc(x.input.battery.id), f(x.auw * 1000, 1), f(x.twr), `${f(x.hover.throttle * 100, 0)} %`, f(x.flightTimeMin, 1),
      x.input.motor.availability === 'limited' || x.input.prop.availability === 'limited' ? '限定' : '汎用',
      statusPill(x.feasible), esc(x.checks.filter((c) => !c.pass).map((c) => c.label).join('、')),
    ]),
  );
};

export const iterationsHtml = (r: Stage2Result): string =>
  table(
    ['反復', '電子回路質量（入力）[g]', '選択された構成', '全備重量 [g]', 'TWR', '飛行時間 [分]'],
    r.iterations.map((it) => [it.iter, f(it.electronicsMassG), esc(it.choice), f(it.auwG, 1), f(it.twr), f(it.flightTimeMin, 1)]),
  );

export const calcTableHtml = (r: Stage2Result): string =>
  table(
    ['分類', '検証項目', '式・条件', '値', '基準', '判定', '備考'],
    r.calc.checks.map((c) => [esc(c.group), esc(c.label), esc(c.formula), `${f(c.value)} ${esc(c.unit)}`, `${c.op === 'lt' ? '<' : '≥'} ${c.limit} ${esc(c.unit)}`, statusPill(c.pass), esc(c.note)]),
  );

export const bomTableHtml = (r: Stage2Result): string =>
  table(
    ['参照', '数量', '品名', '型番', 'メーカ', 'パッケージ', '質量 [g]', '代替品', '購入先（検索）', '要確認'],
    r.bom.map((b) => [
      esc(b.refs.join(', ')), b.qty, esc(b.name), esc(b.mpn), esc(b.manufacturer), esc(b.package), f(b.totalMassG, 3), esc(b.alternatives),
      vendorLinks(b.mpn).map((v) => `<a href="${v.url}" target="_blank" rel="noopener">${esc(v.vendor)}</a>`).join(' '),
      esc(b.verify),
    ]),
  );

export const gpioTableHtml = (r: Stage2Result): string =>
  table(['信号', 'GPIO', '備考'], r.circuit.gpio.map((g) => [esc(g.signal), esc(g.gpio), esc(g.note)]));

export const throttleChartsHtml = (s: SizingResult): string => {
  const curve = throttleCurve(s);
  const hoverG = (s.auw * 1000) / s.input.rotorCount;
  const thrust = lineChartSvg({
    title: 'スロットルと静止推力（1 ロータ）',
    xLabel: 'スロットル [%]',
    yLabel: '推力 [gf]',
    series: [{ name: '推力', points: curve.map((c) => [c.throttle * 100, c.thrustG]) }],
    refLines: [{ y: hoverG, label: 'ホバリング' }],
    yMin: 0,
  });
  const current = lineChartSvg({
    title: 'スロットルと電池電流（全ロータ合計）',
    xLabel: 'スロットル [%]',
    yLabel: '電流 [A]',
    series: [{ name: '電流', points: curve.map((c) => [c.throttle * 100, c.batteryCurrent]) }],
    yMin: 0,
  });
  return `<div class="grid2">${thrust}${current}</div>`;
};
