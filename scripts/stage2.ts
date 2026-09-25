/**
 * Stage 2: propulsion sizing + electrical design (goals G2-1..G2-4).
 */
import { PRESET_250_QUAD } from '../src/core/presets';
import { bomCsv, kicadNetlist, netlistJson } from '../src/electrical/export';
import { renderSchematicSvg } from '../src/electrical/schematic';
import { runStage2 } from '../src/integration/stage2';
import { esc, figure, renderReport, table } from '../src/report/html';
import { REFS } from '../src/report/references';
import {
  bomTableHtml, calcTableHtml, gpioTableHtml, iterationsHtml, massTableHtml, searchTableHtml, sizingChecksHtml, sizingSummaryHtml, throttleChartsHtml,
} from '../src/report/stage2-html';
import { sizePropulsion } from '../src/sizing/propulsion';
import { findBattery, findMotor, findProp } from '../src/core/propulsion-catalog';
import { fmt, nowString, writeJson, writeText } from './common';
import { startShooter } from './shot';

const main = async (): Promise<void> => {
  const r = runStage2({ rotorCount: 4 });
  const s = r.sizing;
  const check = (label: string) => s.checks.find((c) => c.label === label)!;
  const twr = check('推力重量比 TWR');
  const thr = check('ホバリングスロットル');
  const ft = check('推定ホバリング飛行時間');
  const singleNets = r.circuit.nets.filter((n) => n.pins.length < 2);
  const unconnectedPower = r.circuit.components.flatMap((c) => c.pins.filter((p) => /^(GND|VSS|VDD|VDDIO|3V3|VIN|VOUT)$/.test(p.name) && p.net === null).map((p) => `${c.ref}.${p.name}`));
  const goals = [
    { id: 'G2-1', title: '推力余裕', criteria: 'TWR ≥ 2.0 かつ ホバリングスロットル ≤ 60 %', result: `TWR ${fmt(twr.value, 2)}、スロットル ${fmt(thr.value, 1)} %`, pass: twr.pass && thr.pass },
    { id: 'G2-2', title: '飛行時間', criteria: 'ホバリング飛行時間 ≥ 5 分', result: `${fmt(ft.value, 1)} 分`, pass: ft.pass },
    { id: 'G2-3', title: '電気的検証', criteria: `全 ${r.calc.checks.length} 項目に合格`, result: `${r.calc.checks.filter((c) => c.pass).length} / ${r.calc.checks.length} 合格`, pass: r.calc.pass },
    { id: 'G2-4', title: 'ネットリスト健全性', criteria: '1 ピンだけのネット 0、電源ピンの未接続 0', result: `1 ピンネット ${singleNets.length}、電源未接続 ${unconnectedPower.length}`, pass: singleNets.length === 0 && unconnectedPower.length === 0 },
  ];
  for (const g of goals) console.log(`  ${g.id} ${g.pass ? 'PASS' : 'FAIL'} ${g.result}`);

  // ---------- artifacts ----------
  const svg = renderSchematicSvg(r.circuit);
  writeText('out/stage2/schematic.svg', svg);
  writeText('reports/img/stage2-schematic.svg', svg);
  writeText('out/stage2/bom.csv', bomCsv(r.bom));
  writeText('out/stage2/netlist.net', kicadNetlist(r.circuit));
  writeJson('out/stage2/netlist.json', netlistJson(r.circuit));
  writeJson('out/stage2/design.json', {
    rotorCount: r.rotorCount,
    motor: s.input.motor.id,
    prop: s.input.prop.id,
    battery: s.input.battery.id,
    electronicsMassG: r.electronicsMassG,
    auwG: s.auw * 1000,
    armLengthM: s.armLength,
    twr: s.twr,
    flightTimeMin: s.flightTimeMin,
    traceWidth: r.calc.traceWidth,
    goals,
  });

  // ---------- Class B comparison (module based) ----------
  const classB = PRESET_250_QUAD();
  const sb = sizePropulsion({ rotorCount: 4, motor: findMotor('bl-2204-2300'), prop: findProp('prop-5045'), battery: findBattery('lipo-3s-1300'), electronicsMass: 0.065, frameMass: 0.12 });
  const classBTable = table(
    ['区分', '推奨（汎用・入れ替え可能）', '備考'],
    [
      ['フライトコントローラ', 'STM32F405 系 FC（30.5 mm 取付）', 'ArduPilot / Betaflight / INAV が動作。メーカー多数で代替容易'],
      ['ESC', '4in1 ESC 30 A（AM32 または BLHeli_S ファームウェア）', 'AM32 はオープンソース（GPL-3.0）'],
      ['コンパニオン', 'Raspberry Pi Zero 2 W', '経路計画・カメラ処理。姿勢制御は FC が担当（Linux は非リアルタイム）'],
      ['GNSS', 'u-blox M10 系モジュール', '屋外の位置推定'],
      ['受信機', 'ExpressLRS 2.4 GHz（技適品を選定）', '手動操縦・フェイルセーフ'],
    ],
  );

  // ---------- screenshot of the UI ----------
  const shooter = await startShooter();
  try {
    await shooter.shoot('tab=electrical', 'reports/img/stage2-ui.png');
  } finally {
    await shooter.close();
  }

  const html = renderReport({
    stage: 2,
    title: '段階2 レポート: 推進系サイジングと電気系統設計',
    subtitle: `推奨構成: ${s.input.motor.name} ×${r.rotorCount} / ${s.input.prop.name} / ${s.input.battery.name}`,
    generatedAt: nowString(),
    goals,
    sections: [
      {
        title: '設計の流れ',
        html: `<ol>
<li>カタログ（モータ ${new Set(r.search.all.map((x) => x.input.motor.id)).size} 種 × プロペラ × 電池）の適合する全 ${r.search.all.length} 組合せを、モータの電気モデルと電池の電圧降下を連立させて評価した。</li>
<li>TWR・ホバリングスロットル・飛行時間・100 g 未満・放電レート・モータ電流の条件を満たす組合せから、<b>汎用品（多メーカー品）を優先</b>し、その中で飛行時間が最長のものを選んだ。</li>
<li>選んだ構成から回路を自動生成し、BOM と基板面積から電子回路の質量を求めた。その質量で再度サイジングし、構成と質量が変わらなくなるまで反復した。</li>
<li>回路の各部（MOSFET、ゲート抵抗、還流ダイオード、LDO、分圧器、I²C、配線幅）を計算で検証した。</li></ol>`,
      },
      { title: '推奨構成（サイジング結果）', html: sizingSummaryHtml(s) + sizingChecksHtml(s) },
      { title: '質量内訳', html: massTableHtml(s) },
      { title: '推進系の特性', html: throttleChartsHtml(s) },
      { title: '組合せ探索（上位）', html: searchTableHtml(r) },
      { title: '質量の収束反復（試行の繰り返し）', html: iterationsHtml(r) },
      { title: '回路図', html: `<p class="note">ファイル: <code>out/stage2/schematic.svg</code>、ネットリスト: <code>out/stage2/netlist.net</code>（KiCad 形式）、<code>netlist.json</code></p><div class="svgbox"><img src="img/stage2-schematic.svg" style="width:100%" alt="回路図"></div>` },
      { title: '電気計算と検証', html: calcTableHtml(r) + `<p class="note">推奨配線幅: 信号 ${r.calc.traceWidth.signal} mm、3.3 V ${r.calc.traceWidth.power3v3} mm、モータ ${r.calc.traceWidth.motor} mm、VBAT ${r.calc.traceWidth.vbat} mm（両面ベタで補強）</p>` },
      { title: 'GPIO 割当て（ファームウェア用）', html: gpioTableHtml(r) },
      { title: '部品表（BOM）', html: `<p class="note">ファイル: <code>out/stage2/bom.csv</code>。購入先は検索リンク（価格・在庫は各サイトで確認）。</p>${bomTableHtml(r)}` },
      {
        title: 'Class B（250 級ブラシレス）の構成案',
        html: `<p class="note">ブラシレス ESC の自作は難度と発火リスクが高いため、Class B は市販モジュールの組合せとする。参考サイジング: 全備重量 ${fmt(sb.auw * 1000, 0)} g、TWR ${fmt(sb.twr, 1)}、ホバリング ${fmt(sb.flightTimeMin, 1)} 分（${esc(classB.name)}）。</p>${classBTable}`,
      },
      { title: 'UI', html: figure('img/stage2-ui.png', '推進・電気タブ（構成の変更とその場での再計算）') },
    ],
    concerns: [
      'モータ・プロペラの係数と LiPo の内部抵抗は代表値。推力台での実測（推力・電流・回転数）で置き換えるまで、飛行時間とスロットルは ±20〜30 % の誤差を見込む。',
      'LGA パッケージ（IMU・気圧センサ）のピン配置とモジュールのパッド寸法はデータシートでの最終確認が必要（BOM の「要確認」欄）。',
      'ESP32-S3 の Wi-Fi 送信ピーク（約 340 mA）とモータ起動電流が重なると、電池電圧が瞬間的に下がる。LDO 出力の実測（オシロスコープ）でブラウンアウトの有無を確認すること。',
      'ブラシ付きモータは PWM のたびに電気ノイズを出す。IMU の配線とモータ配線を離し、モータ端子にセラミックコンデンサ（0.1 µF）を追加することを検討する。',
      '電池リードは 20 AWG 以上とし、コネクタは BT2.0 など大電流品にする。JST PH は定格不足。',
      '部品の価格と在庫は取得していない（規約上スクレイピングしない）。Digi-Key・Mouser・Nexar の公式 API キーがあれば自動取得に拡張できる。',
    ],
    references: [REFS.espDrone, REFS.crazyflie, REFS.skidl, REFS.am32, REFS.betaflight, REFS.ardupilot],
  });
  writeText('reports/stage2.html', html);
  const pass = goals.every((g) => g.pass);
  console.log(`[stage2] ${pass ? 'ALL GOALS PASSED' : 'SOME GOALS FAILED'}`);
  if (!pass) process.exitCode = 1;
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
