/**
 * Variant C: outdoor vehicle (brushless 2S, 4-in-1 ESC, step-down FC supply, GNSS, return-to-home).
 * Reuses the variant-B board blocks, the GNSS port and the frame generator. Variants A/B outputs are not touched.
 */
import { readFileSync } from 'node:fs';
import gerberParser from 'gerber-parser';
import pcbStackup from 'pcb-stackup';
import { meshToStl } from '../src/airframe/mesh';
import { GAINS_OUTDOOR, GNSS_MODULE, OUTDOOR_BUILD, SENSORS_GNSS_M10 } from '../src/core/presets';
import type { DroneParams } from '../src/core/types';
import { ESC_RULES } from '../src/electrical/calc-esc';
import { findPart } from '../src/electrical/catalog';
import { bomCsv, kicadNetlist } from '../src/electrical/export';
import { renderSchematicSvg } from '../src/electrical/schematic';
import { runStage2 } from '../src/integration/stage2';
import { airframeSummary } from '../src/integration/stage4';
import { deriveDroneParams } from '../src/integration/stage5';
import type { AirframeLike } from '../src/integration/stage5';
import { calibratedMassModel, designAirframeC, droneParamsC, runStage2C, runStage3C } from '../src/integration/variantC';
import { zipStore } from '../src/pcb/gerber';
import { renderPcbSvg } from '../src/pcb/svg';
import { lineChartSvg } from '../src/report/chart';
import { esc, figure, renderReport, statusPill, table } from '../src/report/html';
import { bomTableHtml, calcTableHtml, gpioTableHtml, massTableHtml, searchTableHtml, sizingChecksHtml } from '../src/report/stage2-html';
import { OUTDOOR_C_LIMITS, OUTDOOR_C_SCENARIOS, OUTDOOR_LIMITS, hoverMargin, runScenario, windSweep } from '../src/sim/scenarios';
import { SIZING_RULES, SIZING_RULES_OUTDOOR } from '../src/sizing/propulsion';
import { fmt, nowString, writeJson, writeText } from './common';
import { loadManifold } from './load';
import { startShooter } from './shot';

const SEEDS = [1, 2, 3, 4, 5];
const SWEEP_WINDS = Array.from({ length: 15 }, (_, i) => i);
const SWEEP_SEEDS = [1, 2];
/** Drag-model multipliers for the wind-limit sensitivity (drag area and rotor drag). */
const DRAG_CASES = [1, 2];
/** GC-7: motor-command headroom in an 8 m/s mean wind. */
const MARGIN_WIND = 8;
const MARGIN_LIMIT = 0.6;

const gerberErrors = (files: Record<string, string>): Promise<number> =>
  Promise.all(
    Object.entries(files).map(
      ([name, text]) =>
        new Promise<number>((resolve) => {
          const p = gerberParser({ filetype: name.endsWith('.drl') ? 'drill' : 'gerber' });
          p.on('error', () => resolve(1));
          p.on('end', () => resolve(0));
          p.on('data', () => undefined);
          p.write(text);
          p.end();
          p.resume();
        }),
    ),
  ).then((r) => r.reduce((a, b) => a + b, 0));

const withDrag = (p: DroneParams, k: number): DroneParams => ({ ...p, dragArea: p.dragArea * k, rotorDrag: p.rotorDrag * k });

const main = async (): Promise<void> => {
  const t0 = Date.now();
  const wasm = await loadManifold();

  // ---------------- stage 2/3/4 loop ----------------
  console.log('[variantC] propulsion search (outdoor candidates) + circuit…');
  const s2a = runStage2C();
  console.log(`  pass 1: ${s2a.iterations[s2a.iterations.length - 1].choice} ${fmt(s2a.sizing.auw * 1000, 1)} g`);
  console.log('[variantC] FC board (placement → routing → DRC)…');
  const s3 = runStage3C(s2a);
  const d = s3.pcb.design;
  console.log(`  board ${d.board.w}×${d.board.h} success=${s3.pcb.success}`);
  const af1 = designAirframeC(wasm, s2a, s3);
  const mm2 = calibratedMassModel(s2a, af1);
  const s2 = runStage2C({ massModel: mm2, board: d.board });
  const changed = s2.sizing.input.battery.id !== s2a.sizing.input.battery.id || s2.sizing.input.prop.id !== s2a.sizing.input.prop.id || s2.sizing.input.motor.id !== s2a.sizing.input.motor.id;
  console.log(`  pass 2 (frame ${fmt(mm2.frameMassPerWheelbase * 1000, 1)} g/m): ${s2.iterations[s2.iterations.length - 1].choice} ${fmt(s2.sizing.auw * 1000, 1)} g${changed ? '（構成変更）' : ''}`);
  const a = designAirframeC(wasm, s2, s3);
  const aSum = airframeSummary(a) as AirframeLike;
  const pC = droneParamsC(s2, aSum);

  // ---------------- outputs ----------------
  const out = 'out/variantC';
  writeText(`${out}/frame.stl`, meshToStl(a.frame, 'drone-frame-C'));
  writeJson(`${out}/airframe.json`, aSum);
  writeJson(`${out}/pcb.json`, { design: d, stats: s3.pcb.stats, drc: { counts: s3.pcb.drc.counts, violations: s3.pcb.drc.violations.slice(0, 50) }, attempts: s3.pcb.attempts });
  writeText(`${out}/fc_gerber.zip`, zipStore(s3.gerbers.files));
  writeText(`${out}/fc.kicad_pcb`, s3.kicad);
  writeText(`${out}/fc_cpl.csv`, s3.gerbers.cpl);
  writeText(`${out}/bom.csv`, bomCsv(s2.bom));
  writeText(`${out}/netlist.net`, kicadNetlist(s2.circuit));
  const sch = renderSchematicSvg(s2.circuit, 3);
  writeText(`${out}/schematic.svg`, sch);
  writeText('reports/img/variantC-schematic.svg', sch);
  writeText('reports/img/variantC-pcb-top.svg', renderPcbSvg(d, { scale: 18, title: `版 C 基板 ${d.board.w}×${d.board.h} mm（J1 = ESC、J4 = GNSS、J2 = フロー子基板）`, highlightNets: ['VBAT', 'SW', 'ESC_M1', 'ESC_M2', 'ESC_M3', 'ESC_M4'] }));
  const stack = await pcbStackup(Object.entries(s3.gerbers.files).map(([filename, gerber]) => ({ filename, gerber })), { outlineGapFill: 0.05 });
  writeText('reports/img/variantC-gerber-top.svg', stack.top.svg);
  const gerbErr = await gerberErrors(s3.gerbers.files);
  writeJson(`${out}/drone_params.json`, pC);

  // ---------------- simulation ----------------
  console.log('[variantC] outdoor scenarios × seeds…');
  const runs = OUTDOOR_C_SCENARIOS.map((def) => ({ def, runs: SEEDS.map((seed) => runScenario(def, pC, { seed })) }));
  for (const r of runs) console.log(`  ${r.def.id} ${r.runs.filter((x) => x.pass).length}/${r.runs.length}`);
  // variant B + GNSS with the same outdoor controller settings
  const s2B = runStage2({ rotorCount: 4, gnssConnector: true });
  const afB = JSON.parse(readFileSync('out/variantB/airframe.json', 'utf-8')) as AirframeLike;
  const pB: DroneParams = { ...deriveDroneParams(s2B.sizing, afB, { massG: afB.massG + GNSS_MODULE.massG }), sensors: SENSORS_GNSS_M10, gains: GAINS_OUTDOOR, name: '版 B＋GNSS（屋外設定）' };
  console.log('[variantC] thrust margin and wind sweeps (B+GNSS vs C)…');
  const marginWinds = [0, 5, MARGIN_WIND];
  const margins = { B: marginWinds.map((w) => hoverMargin(pB, w, 1, 0.25, SIZING_RULES.usableCapacity)), C: marginWinds.map((w) => hoverMargin(pC, w, 1, 0.25, SIZING_RULES_OUTDOOR.usableCapacity)) };
  const sweeps = DRAG_CASES.map((k) => ({ k, B: windSweep(withDrag(pB, k), SWEEP_WINDS, SWEEP_SEEDS), C: windSweep(withDrag(pC, k), SWEEP_WINDS, SWEEP_SEEDS) }));
  for (const s of sweeps) console.log(`  drag ×${s.k}: wind limit B ${s.B.limit} m/s, C ${s.C.limit} m/s`);

  // ---------------- goals ----------------
  const sz = s2.sizing;
  const chk = (label: string) => a.checks.find((c) => c.label.startsWith(label))!;
  const mB = margins.B[margins.B.length - 1], mC = margins.C[margins.C.length - 1];
  const scen = (id: string) => runs.find((r) => r.def.id === id)!;
  const allPass = (id: string): boolean => scen(id).runs.every((r) => r.pass);
  const goals = [
    { id: 'GC-1', title: '屋外用推進系', criteria: `全備重量 < ${SIZING_RULES_OUTDOOR.massLimit * 1000} g、TWR ≥ ${SIZING_RULES_OUTDOOR.minTwr}、ホバ. ≤ ${SIZING_RULES_OUTDOOR.maxHoverThrottle * 100} %、飛行時間 ≥ ${SIZING_RULES_OUTDOOR.minFlightTimeMin} 分`, result: `${sz.input.motor.name} / ${sz.input.prop.name} / ${sz.input.battery.name}、${fmt(sz.auw * 1000, 1)} g、TWR ${fmt(sz.twr)}、ホバ. ${fmt(sz.hover.throttle * 100, 0)} %、${fmt(sz.flightTimeMin, 1)} 分`, pass: sz.feasible },
    { id: 'GC-2', title: '版 C 回路の電気計算', criteria: '全項目合格、1 ピンだけのネットなし', result: `${s2.calc.checks.filter((c) => c.pass).length} / ${s2.calc.checks.length} 合格`, pass: s2.calc.pass },
    { id: 'GC-3', title: '版 C 基板', criteria: '全ネット配線・DRC 違反 0・Gerber 構文エラー 0', result: `${d.board.w}×${d.board.h} mm、未配線 ${d.unrouted.length}、DRC ${s3.pcb.drc.violations.length}、Gerber エラー ${gerbErr}`, pass: s3.pcb.success && gerbErr === 0 },
    { id: 'GC-4', title: '版 C 機体', criteria: '重心ずれ < 2 mm、STL 閉多様体、プロペラ隙間、腕強度 ≥ 3、全備重量 < 100 g、ESC スタック', result: `${fmt(a.massG, 1)} g、重心ずれ ${fmt(chk('重心').value, 3)} mm、境界辺 ${a.watertight.boundaryEdges}、腕安全率 ${fmt(chk('腕の曲げ').value, 1)}、全 ${a.checks.length} 項目中 ${a.checks.filter((c) => c.pass).length} 合格`, pass: a.checks.every((c) => c.pass) && a.watertight.watertight },
    { id: 'GC-5', title: '屋外シナリオ', criteria: `GC-5a・5b・5c が乱数 ${SEEDS.length} 通りすべて合格`, result: ['GC-5a', 'GC-5b', 'GC-5c'].map((id) => `${id} ${scen(id).runs.filter((r) => r.pass).length}/${SEEDS.length}`).join('、'), pass: ['GC-5a', 'GC-5b', 'GC-5c'].every(allPass) },
    { id: 'GC-6', title: '通信断からの自動帰還', criteria: `ホームから ${OUTDOOR_LIMITS.landing} m 以内に着陸（${SEEDS.length} 通り）`, result: `${scen('GC-6').runs.filter((r) => r.pass).length}/${SEEDS.length}、着陸誤差 最大 ${fmt(Math.max(...scen('GC-6').runs.map((r) => r.criteria.find((c) => c.label.startsWith('ホーム'))!.value)), 2)} m`, pass: allPass('GC-6') },
    { id: 'GC-7', title: '強風時の推力余裕', criteria: `平均風 ${MARGIN_WIND} m/s でモータ指令 99 % 値 ≤ ${MARGIN_LIMIT * 100} % かつ版 B＋GNSS より小さい`, result: `版 C ${fmt(mC.uP99 * 100, 0)} %、版 B＋GNSS ${fmt(mB.uP99 * 100, 0)} %`, pass: mC.uP99 <= MARGIN_LIMIT && mC.uP99 < mB.uP99 },
  ];
  for (const g of goals) console.log(`  ${g.id} ${g.pass ? 'PASS' : 'FAIL'} ${g.result}`);

  // ---------------- screenshots ----------------
  const shooter = await startShooter();
  const shots = [
    { q: 'capture=1&variant=C&tab=airframe&view=iso', f: 'variantC-iso.png', c: '版 C 屋外機（ブラシレス 1204・3 インチ・2S、ESC スタック、機首上に GNSS）' },
    { q: 'capture=1&variant=C&tab=airframe&view=side', f: 'variantC-side.png', c: '側面：プレート → ESC → FC のスタック、GNSS は機首上（プロペラ面より低い）' },
    { q: 'capture=1&variant=C&tab=airframe&view=iso&frameOnly=1&disks=0&cg=0', f: 'variantC-frame.png', c: 'フレーム C（ボルト固定台座・ESC 支柱・太い腕、機首は子基板の後付け用に残す）' },
    { q: 'capture=1&variant=C&tab=pcb&view=3d', f: 'variantC-pcb-3d.png', c: '版 C 基板 3D（降圧 DC-DC・ESC 端子・GNSS 端子）' },
    { q: 'capture=1&variant=C&tab=assembly&scenario=GC-5b&view=top&scale=25', f: 'variantC-route-top.png', c: 'GC-5b 40 m 四方の軌跡（平均風 5 m/s、機体は表示 25 倍）' },
    { q: 'capture=1&variant=C&tab=assembly&scenario=GC-6&view=top&scale=25', f: 'variantC-rth-top.png', c: 'GC-6 通信断 → 自動帰還 → ホームに着陸' },
    { q: 'capture=1&variant=C&tab=assembly&scenario=GC-5c&view=follow&at=30&scale=1', f: 'variantC-fly.png', c: '平均風 8 m/s の中でホバリングする版 C（風上に傾いて位置を保持）' },
  ];
  try {
    for (const s of shots) await shooter.shoot(s.q, `reports/img/${s.f}`);
  } finally {
    await shooter.close();
  }

  // ---------------- charts ----------------
  const sweepChart = (k: number): string => {
    const s = sweeps.find((x) => x.k === k)!;
    const pts = (r: typeof s.B): Array<[number, number]> => r.points.map((p) => [p.wind, Number.isFinite(p.maxH) ? Math.min(p.maxH, 10) : 10]);
    return lineChartSvg({ title: `平均風速とホバリング位置誤差（抗力 ×${k}、10 m で打ち切り）`, xLabel: '平均風速 [m/s]', yLabel: '最大水平誤差 [m]', series: [{ name: '版 B＋GNSS', points: pts(s.B) }, { name: '版 C', points: pts(s.C) }], refLines: [{ y: OUTDOOR_C_LIMITS.windSweepHoriz, label: '基準' }], yMin: 0, yMax: 10 });
  };
  const hov = scen('GC-5c').runs[0].sim.samples.filter((s) => s.phase === 'hover');
  const chartTilt = lineChartSvg({ title: 'GC-5c 平均風 8 m/s（突風込み）での機体の傾き', xLabel: '時間 [s]', yLabel: '傾き [deg]', series: [{ name: '傾き', points: hov.map((s) => [s.t, (Math.hypot(s.roll, s.pitch) * 180) / Math.PI]) }], refLines: [{ y: (GAINS_OUTDOOR.maxTiltRad * 180) / Math.PI, label: '傾き制限' }], yMin: 0 });
  const chartWind = lineChartSvg({ title: 'GC-5c 風速（平均 8 m/s、突風 σ2 m/s）', xLabel: '時間 [s]', yLabel: '風速 [m/s]', series: [{ name: '風速', points: hov.map((s) => [s.t, Math.hypot(s.wind.x, s.wind.y)]) }], yMin: 0 });
  const rth = scen('GC-6').runs[0].sim.samples;
  const chartRth = lineChartSvg({ title: 'GC-6 自動帰還：ホームからの水平距離と高度', xLabel: '時間 [s]', yLabel: '[m]', series: [{ name: 'ホームからの距離', points: rth.map((s) => [s.t, Math.hypot(s.p.x, s.p.y)]) }, { name: '高度', points: rth.map((s) => [s.t, s.p.z]) }], yMin: 0 });

  // ---------------- report ----------------
  const escPart = findPart('ESC-4in1-AM32');
  const reuse = [
    ['メイン基板のマイコン・IMU・気圧・GNSS 端子・フロー端子', '回路ブロックを流用', '同じ生成器（generateCircuit）のオプションで派生。GPIO 割当・ネット名・部品は共通'],
    ['メイン基板の電源（1S LDO）', '<b>流用不可</b>', `LDO の入力上限 6 V に対し 2S 満充電 8.4 V。降圧 DC-DC（MP2359、〜24 V）に差し替え`],
    ['メイン基板のモータ駆動（MOSFET 直駆動）', '<b>流用不可</b>', 'ブラシレスには 3 相インバータ（ESC）が必要。自作は難度・安全性から避け、市販 4-in-1 ESC（AM32）を JST-SH 8 で接続'],
    ['センサ子基板（フロー＋ToF）', '流用可（任意）', '屋外の GNSS 航法には不要。機首下の取付穴を残したので版 B の子基板をそのまま後付けでき、低高度の精密着陸に使える'],
    ['GNSS＋コンパス モジュール', 'そのまま流用', '版 B と同じ 6 ピン配列。版 C では機首の上面に固定'],
    ['8520 ブラシ付きモータ・65 mm プロペラ・1S 電池', '<b>流用しない</b>', `推力重量比 ${fmt(s2B.sizing.twr)}。強風時の推力余裕が小さく（下表）、ブラシの摩耗・発熱で屋外の連続高負荷に弱い`],
    ['フレーム生成器', '拡張して流用', 'ボルト固定台座・ESC 支柱・GNSS 台・寸法上書きを追加（版 A/B の形状は不変）'],
    ['制御・推定・経路計画', '流用＋追加', '屋外用の制御設定（傾き 45°、加速度・積分の上限拡大）と自動帰還（RTH）を追加'],
  ];
  const marginRows = (['B', 'C'] as const).flatMap((k) => margins[k].map((m) => [k === 'B' ? '版 B＋GNSS' : '版 C', fmt(m.wind, 0), `${fmt(m.uP99 * 100, 0)} %`, `${fmt(m.saturation * 100, 1)} %`, fmt(m.meanCurrent, 2), fmt(m.enduranceMin, 1), fmt(m.maxTiltDeg, 0), fmt(m.maxH, 2)]));
  const compareRows = [
    ['全備重量 [g]', fmt(afB.massG + GNSS_MODULE.massG, 1), fmt(a.massG, 1)],
    ['推力重量比 TWR', fmt(s2B.sizing.twr), fmt(sz.twr)],
    ['ホバリングスロットル（サイジング）', `${fmt(s2B.sizing.hover.throttle * 100, 0)} %`, `${fmt(sz.hover.throttle * 100, 0)} %`],
    ['推定ホバリング飛行時間（サイジング）[分]', fmt(s2B.sizing.flightTimeMin, 1), fmt(sz.flightTimeMin, 1)],
    ['電池', esc(s2B.sizing.input.battery.name), esc(sz.input.battery.name)],
    ['モータ', esc(s2B.sizing.input.motor.name), esc(sz.input.motor.name)],
    [`位置保持できる最大平均風速（抗力 ×1 / ×2）[m/s]`, sweeps.map((s) => s.B.limit).join(' / '), sweeps.map((s) => s.C.limit).join(' / ')],
    ['巡航速度の上限（制御設定）[m/s]', fmt(GAINS_OUTDOOR.maxHorizSpeed, 0), fmt(GAINS_OUTDOOR.maxHorizSpeed, 0)],
  ];
  const html = renderReport({
    stage: 7,
    title: '改良版 C レポート: 屋外飛行機',
    subtitle: '版 A・B を残したまま、既存の基板ブロック・GNSS・フレーム生成器を流用して、風のある屋外を GNSS で飛ぶ 100 g 未満の機体を設計',
    generatedAt: nowString(),
    goals,
    sections: [
      { title: '完成機体 C', html: `<div class="grid2">${shots.map((s) => figure(`img/${s.f}`, s.c)).join('')}</div>` },
      { title: '既存資産の流用判断', html: table(['資産', '判断', '理由・対応'], reuse.map((r) => [esc(r[0]), r[1], esc(r[2])])) },
      {
        title: '推進系（屋外用の候補・基準で探索）',
        html: `<p>屋外用の基準：TWR ≥ ${SIZING_RULES_OUTDOOR.minTwr}（突風・風上への加速）、ホバリングスロットル ≤ ${SIZING_RULES_OUTDOOR.maxHoverThrottle * 100} %、飛行時間 ≥ ${SIZING_RULES_OUTDOOR.minFlightTimeMin} 分、全備重量 < ${SIZING_RULES_OUTDOOR.massLimit * 1000} g（100 g 未満を組立ばらつき込みで守るための設計目標）。</p>
${table(['反復', 'フレーム質量モデル [g/m]', '選択', '全備重量 [g]', 'TWR', '飛行時間 [分]'], [
  [1, fmt(s2a.sizing.frameMass / s2a.sizing.wheelbase * 1000, 1), esc(s2a.iterations[s2a.iterations.length - 1].choice), fmt(s2a.sizing.auw * 1000, 1), fmt(s2a.sizing.twr), fmt(s2a.sizing.flightTimeMin, 1)],
  [2, fmt(mm2.frameMassPerWheelbase * 1000, 1), esc(s2.iterations[s2.iterations.length - 1].choice), fmt(sz.auw * 1000, 1), fmt(sz.twr), fmt(sz.flightTimeMin, 1)],
])}
<p class="note">反復 1 はフレーム質量を腕長からの概算で見積もり、反復 2 は生成したフレームの実質量（${fmt(af1.frameMassG, 1)} g）で再探索した（Sim-to-Real と同じ考え方の設計ループ）。${changed ? '反復 2 で構成が変わったため機体を再生成した。' : '構成は変わらなかった。'}</p>
${sizingChecksHtml(sz)}${massTableHtml(sz)}${searchTableHtml(s2, 20)}`,
      },
      {
        title: '回路（版 B の回路ブロック＋降圧電源＋ESC 端子）',
        html: `<div class="svgbox"><img src="img/variantC-schematic.svg" style="width:100%" alt="版 C 回路図"></div>
<p>ESC は市販の ${esc(escPart.name)}（${escPart.massG} g）。FC とは JST-SH 8（VBAT・GND・電流・M1〜M4・テレメトリ）1 本で接続し、FC は ESC ハーネスの VBAT から降圧で 3.3 V を作る。</p>
${gpioTableHtml(s2)}${calcTableHtml(s2)}${bomTableHtml(s2)}`,
      },
      {
        title: '基板',
        html: `<div class="grid2">${figure('img/variantC-pcb-top.svg', `版 C 基板 ${d.board.w}×${d.board.h} mm（電源・ESC 信号を強調）`)}${figure('img/variantC-gerber-top.svg', 'Gerber からの独立描画（tracespace）')}</div>
${table(['試行', '基板', 'GND 戦略', '配置失敗', '未配線', 'DRC', '結果'], s3.pcb.attempts.map((x) => [x.attempt, x.board, x.gnd, x.placementFailures, x.unrouted, x.drcViolations, esc(x.note)]))}
<p class="note">ESC 用の信号（DShot ×4・電流・テレメトリ）はモジュールの同じ辺の GPIO に集め、ESC 端子をその辺の基板端に固定した。当初 IO4〜IO7 / IO2 / IO40 に分散させた割当てでは 38〜40 mm 角で未配線が 1〜3 本残った。</p>`,
      },
      {
        title: '機体',
        html: `${table(['検証項目', '値', '基準', '判定', '備考'], a.checks.map((c) => [esc(c.label), `${fmt(c.value, 2)} ${esc(c.unit)}`, `${c.op === 'lt' ? '<' : '≥'} ${c.limit} ${esc(c.unit)}`, statusPill(c.pass), esc(c.note ?? '')]))}
${table(['部品', '質量 [g]'], a.items.filter((i) => !i.name.startsWith('部品 ')).map((i) => [esc(i.name), fmt(i.massG, 2)]).concat([['基板上の部品（合計）', fmt(a.items.filter((i) => i.name.startsWith('部品 ')).reduce((s, i) => s + i.massG, 0), 2)], ['<b>合計</b>', `<b>${fmt(a.massG, 1)}</b>`]]))}
<p class="note">スタック：プレート → ESC 支柱 ${OUTDOOR_BUILD.escPostHeight} mm → ESC（${escPart.dims.join('×')} mm）→ FC（スタンドオフ ${OUTDOOR_BUILD.frame.standoffHeight} mm）。GNSS は FC・ESC の上ではなく機首の上面に置き、FC の無線アンテナ（後端）からも離した。</p>`,
      },
      {
        title: '屋外飛行（版 C）',
        html: `${table(['シナリオ', '乱数', '主指標', '判定'], runs.flatMap((o) => o.runs.map((r, i) => [esc(o.def.title), SEEDS[i], esc(r.criteria.map((c) => `${c.label} ${fmt(c.value, 2)}`).join('、')), statusPill(r.pass)])))}
<div class="grid2">${chartTilt}${chartWind}${chartRth}</div>`,
      },
      {
        title: '版 B＋GNSS との比較（同じ屋外制御設定）',
        html: `${table(['項目', '版 B＋GNSS', '版 C'], compareRows)}
${table(['機体', '平均風 [m/s]', 'モータ指令 99 % 値', '飽和時間率', '平均電流 [A]', '換算ホバリング時間 [分]', '最大傾き [deg]', '最大水平誤差 [m]'], marginRows)}
<div class="grid2">${DRAG_CASES.map((k) => sweepChart(k)).join('')}</div>
<p><b>評価</b>：シミュレーション上、位置を保てる最大風速は機体の「抗力/質量比」と傾き制限（45°）でほぼ決まり、版 B と版 C で大差はない（抗力 ×1 で B ${sweeps[0].B.limit} / C ${sweeps[0].C.limit} m/s、×2 で B ${sweeps[1].B.limit} / C ${sweeps[1].C.limit} m/s）。版 C の本質的な利点は<b>推力余裕</b>（平均風 ${MARGIN_WIND} m/s でモータ指令 ${fmt(mC.uP99 * 100, 0)} % 対 ${fmt(mB.uP99 * 100, 0)} %）で、突風・上昇・電池電圧の低下・経年劣化・搭載物の追加に対する余裕になる。さらにブラシレスは連続高負荷でもブラシ摩耗がない。ホバリング時間（シミュレーションの平均電流から換算）は版 C ${fmt(margins.C[0].enduranceMin, 1)} 分、版 B＋GNSS ${fmt(margins.B[0].enduranceMin, 1)} 分${margins.C[0].enduranceMin >= margins.B[0].enduranceMin ? 'で、版 C は重くなった分を 2S 電池とプロペラ効率で補っている' : 'で、版 B＋GNSS の方が長い'}。</p>
<p class="note">微風（〜5 m/s）で GNSS 航法を試すだけなら版 B＋GNSS で足りる。常用する屋外機、強風・突風下、将来カメラ等を積む場合は版 C。</p>`,
      },
      {
        title: '法規・運用（日本）',
        html: `<ul><li>全備重量 ${fmt(a.massG, 1)} g（100 g 未満）：航空法上は模型航空機。機体登録・リモート ID は不要。</li>
<li>それでも、空港周辺・高度 150 m 以上の飛行は制限され、小型無人機等飛行禁止法（重要施設周辺）、自治体・公園の条例、土地管理者の許可は適用される。</li>
<li>組立時に配線・接着剤・保護材で質量が増えやすい。100 g に対する余裕は ${fmt(100 - a.massG, 1)} g。完成後に実測し、100 g 以上なら登録とリモート ID が必要になる。</li>
<li>無線は技適取得済みの ESP32-S3-WROOM-1 のみ。GNSS は受信のみ。</li></ul>`,
      },
    ],
    concerns: [
      '耐風性能は抗力モデル（抗力面積・ロータ抗力係数）に強く依存し、その値は推定。抗力 ×2 で位置保持の上限は大きく下がる。実機では風洞・車上試験や飛行ログから同定すること。',
      `100 g に対する余裕が ${fmt(100 - a.massG, 1)} g と小さい。ケーブル長・熱収縮チューブ・ねじ・GNSS ケースで超えやすいので、部品ごとに実測して管理すること。`,
      'MP2359 のピン配置・EN 端子の定格、インダクタの飽和電流、ESC ハーネスのピン順は製品差がある。発注前にデータシートと現物で照合すること（BOM の「要確認」）。',
      `ESC の電流センサ出力の倍率は製品ごとに異なる（ADC ${ESC_RULES.adcBits} bit、IO4）。電池残量推定には電圧（100 k/10 k 分圧）を主に使い、電流は校正後に使うこと。`,
      'GNSS のコンパスは ESC・電池配線の電流磁界の影響を受ける。機首上は ESC から約 30 mm しか離れていないため、実機でモータ全開時の磁界の影響を確認し、必要ならマストで持ち上げること。',
      'ブラシレス ESC の DShot 制御・モータの応答は、シミュレーションではブラシ付きと同じ電圧指令の一次遅れでモデル化している。実機の応答（RPM フィルタ等）はファームウェア側で調整が必要。',
      'ブラシレス機の 3 インチプロペラは危険度が高い。プロペラガードの追加（質量増）か、運用での安全距離の確保を行うこと。',
      '自動帰還はシミュレーション上の機能検証であり、実機ファームウェア（ESP32-S3）は範囲外。帰還高度は周辺の障害物より高く設定すること。',
    ],
  });
  writeText('reports/variantC.html', html);
  writeJson(`${out}/results.json`, {
    goals,
    board: d.board,
    massG: a.massG,
    cg: a.cg,
    sizing: { choice: s2.iterations[s2.iterations.length - 1].choice, auwG: sz.auw * 1000, twr: sz.twr, flightTimeMin: sz.flightTimeMin },
    scenarios: runs.map((o) => ({ id: o.def.id, pass: o.runs.map((r) => r.pass), metrics: o.runs.map((r) => r.criteria.map((c) => c.value)) })),
    margins,
    windLimits: sweeps.map((s) => ({ drag: s.k, B: s.B.limit, C: s.C.limit })),
  });
  const pass = goals.every((g) => g.pass);
  console.log(`[variantC] ${pass ? 'ALL GOALS PASSED' : 'SOME GOALS FAILED'} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  if (!pass) process.exitCode = 1;
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
