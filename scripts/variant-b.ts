/**
 * Variant B: designed optical-flow/ToF sensor sub-board, cable slot, GNSS port, outdoor GNSS flight study.
 * Variant A outputs (out/stage*, reports/stage*.html) are not touched.
 */
import { readFileSync } from 'node:fs';
import gerberParser from 'gerber-parser';
import pcbStackup from 'pcb-stackup';
import { FRAME_CABLE_SLOT } from '../src/airframe/design';
import { meshToStl } from '../src/airframe/mesh';
import { GNSS_MODULE, SENSORS_GNSS_M10 } from '../src/core/presets';
import type { DroneParams } from '../src/core/types';
import { FLOW_BOARD } from '../src/electrical/flowboard';
import { renderSchematicSvg } from '../src/electrical/schematic';
import { runStage2 } from '../src/integration/stage2';
import { runStage3 } from '../src/integration/stage3';
import { airframeSummary } from '../src/integration/stage4';
import { deriveDroneParams } from '../src/integration/stage5';
import type { AirframeLike } from '../src/integration/stage5';
import { designAirframeB, designFlowBoard } from '../src/integration/variantB';
import { zipStore } from '../src/pcb/gerber';
import { renderPcbSvg } from '../src/pcb/svg';
import { lineChartSvg } from '../src/report/chart';
import { esc, figure, renderReport, statusPill, table } from '../src/report/html';
import { OUTDOOR_LIMITS, OUTDOOR_SCENARIOS, SCENARIOS, runScenario } from '../src/sim/scenarios';
import { fmt, nowString, writeJson, writeText } from './common';
import { loadManifold } from './load';
import { startShooter } from './shot';

const GNSS_SEEDS = [1, 2, 3, 4, 5];

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

const main = async (): Promise<void> => {
  const t0 = Date.now();
  const wasm = await loadManifold();
  // ---------------- boards ----------------
  console.log('[variantB] main board with GNSS port (placement → routing → DRC)…');
  const s2 = runStage2({ rotorCount: 4, gnssConnector: true });
  const s3 = runStage3(s2);
  console.log(`  main ${s3.pcb.design.board.w}×${s3.pcb.design.board.h} success=${s3.pcb.success}`);
  console.log('[variantB] sensor sub-board…');
  const flow = designFlowBoard();
  const fd = flow.pcb.design;
  console.log(`  flow ${fd.board.w}×${fd.board.h} success=${flow.pcb.success} mass=${fmt(flow.massG, 2)} g`);
  const flowSensor = fd.placements.find((p) => p.pkg.id === 'PMW3901MB');
  const lens = { ref: flowSensor?.ref ?? 'U2', diameter: FLOW_BOARD.lens.diameter, height: FLOW_BOARD.lens.height };

  // ---------------- airframe ----------------
  const a = designAirframeB(wasm, s2, s3, flow);
  const aSum = airframeSummary(a);
  const refA = JSON.parse(readFileSync('out/stage4/airframe.json', 'utf-8')) as AirframeLike & { frameMassG: number; items: Array<{ name: string; massG: number }>; battery: { x: number } };

  // ---------------- outputs ----------------
  const out = 'out/variantB';
  writeText(`${out}/frame.stl`, meshToStl(a.frame, 'drone-frame-B'));
  writeJson(`${out}/airframe.json`, aSum);
  writeJson(`${out}/pcb.json`, { design: s3.pcb.design, stats: s3.pcb.stats, drc: { counts: s3.pcb.drc.counts, violations: s3.pcb.drc.violations.slice(0, 50) }, attempts: s3.pcb.attempts });
  writeJson(`${out}/flow_pcb.json`, { design: fd, stats: flow.pcb.stats, drc: { counts: flow.pcb.drc.counts, violations: flow.pcb.drc.violations.slice(0, 50) }, attempts: flow.pcb.attempts, lens });
  writeText(`${out}/main_gerber.zip`, zipStore(s3.gerbers.files));
  writeText(`${out}/flow_gerber.zip`, zipStore(flow.gerbers.files));
  writeText(`${out}/main.kicad_pcb`, s3.kicad);
  writeText(`${out}/flow.kicad_pcb`, flow.kicad);
  writeText(`${out}/main_cpl.csv`, s3.gerbers.cpl);
  writeText(`${out}/flow_cpl.csv`, flow.gerbers.cpl);
  const flowSch = renderSchematicSvg(flow.circuit, 2);
  writeText(`${out}/flow_schematic.svg`, flowSch);
  writeText('reports/img/variantB-flow-schematic.svg', flowSch);
  writeText('reports/img/variantB-flow-top.svg', renderPcbSvg(fd, { scale: 28, title: `センサ子基板 ${fd.board.w}×${fd.board.h} mm（部品面＝床側）` }));
  writeText('reports/img/variantB-flow-bottom.svg', renderPcbSvg(fd, { scale: 28, layers: ['B'], title: '子基板 裏面（プレート側）' }));
  writeText('reports/img/variantB-main-top.svg', renderPcbSvg(s3.pcb.design, { scale: 18, title: `メイン基板 B ${s3.pcb.design.board.w}×${s3.pcb.design.board.h} mm（J8 = GNSS）`, highlightNets: ['GNSS_TX', 'GNSS_RX'] }));
  const flowStack = await pcbStackup(Object.entries(flow.gerbers.files).map(([filename, gerber]) => ({ filename, gerber })), { outlineGapFill: 0.05 });
  writeText('reports/img/variantB-flow-gerber-top.svg', flowStack.top.svg);
  const errMain = await gerberErrors(s3.gerbers.files);
  const errFlow = await gerberErrors(flow.gerbers.files);

  // ---------------- simulation ----------------
  console.log('[variantB] indoor goals and outdoor GNSS flights…');
  const pB = { ...deriveDroneParams(s2.sizing, aSum as AirframeLike), name: '改良版 B（センサ子基板・GNSS 端子付き）' };
  const resB = SCENARIOS.map((d) => runScenario(d, pB));
  const pG: DroneParams = { ...deriveDroneParams(s2.sizing, aSum as AirframeLike, { massG: a.massG + GNSS_MODULE.massG }), sensors: SENSORS_GNSS_M10, name: '改良版 B＋GNSS（屋外）' };
  const outdoor = OUTDOOR_SCENARIOS.map((d) => ({ def: d, runs: GNSS_SEEDS.map((seed) => runScenario(d, pG, { seed })) }));
  writeJson(`${out}/drone_params.json`, pB);

  // ---------------- goals ----------------
  const massCheck = a.checks.find((c) => c.label === '全備重量')!;
  const cgCheck = a.checks.find((c) => c.label.startsWith('重心'))!;
  const goals = [
    { id: 'GB-1', title: 'センサ子基板', criteria: '全ネット配線・DRC 違反 0・Gerber 構文エラー 0', result: `${fd.board.w}×${fd.board.h} mm、未配線 ${fd.unrouted.length}、DRC ${flow.pcb.drc.violations.length}、Gerber エラー ${errFlow}`, pass: flow.pcb.success && errFlow === 0 },
    { id: 'GB-2', title: 'メイン基板 B（GNSS 端子付き）', criteria: '全ネット配線・DRC 違反 0', result: `${s3.pcb.design.board.w}×${s3.pcb.design.board.h} mm、未配線 ${s3.pcb.design.unrouted.length}、DRC ${s3.pcb.drc.violations.length}、Gerber エラー ${errMain}`, pass: s3.pcb.success && errMain === 0 },
    { id: 'GB-3', title: '機体 B', criteria: '重心ずれ < 2 mm、STL 閉じた多様体、全備重量 < 100 g', result: `重心ずれ ${fmt(cgCheck.value, 3)} mm、境界辺 ${a.watertight.boundaryEdges}、${fmt(a.massG, 1)} g`, pass: cgCheck.pass && a.watertight.watertight && massCheck.pass },
    { id: 'GB-4', title: '屋内飛行（G1-1〜G1-5）', criteria: '版 B の設計値で全合格', result: resB.map((r) => `${r.id} ${r.pass ? '✓' : '✗'}`).join('、'), pass: resB.every((r) => r.pass) },
    { id: 'GB-5', title: '屋外 GNSS 飛行', criteria: `GNSS モジュール装着（＋${GNSS_MODULE.massG} g）で GB-5a・GB-5b が乱数 ${GNSS_SEEDS.length} 通りすべて合格`, result: outdoor.map((o) => `${o.def.id} ${o.runs.filter((r) => r.pass).length}/${o.runs.length}`).join('、'), pass: outdoor.every((o) => o.runs.every((r) => r.pass)) },
  ];
  for (const g of goals) console.log(`  ${g.id} ${g.pass ? 'PASS' : 'FAIL'} ${g.result}`);

  // ---------------- screenshots ----------------
  const shooter = await startShooter();
  const shots = [
    { q: 'capture=1&variant=B&tab=airframe&view=iso', f: 'variantB-iso.png', c: '改良版 B（機首下にセンサ子基板）' },
    { q: 'capture=1&variant=B&tab=airframe&view=bottom', f: 'variantB-bottom.png', c: '下面：センサ子基板（部品面・レンズが床向き）と電池' },
    { q: 'capture=1&variant=B&tab=airframe&view=iso&frameOnly=1&disks=0&cg=0', f: 'variantB-frame.png', c: 'フレーム B（機首延長・子基板の取付穴・ケーブル通し穴）' },
    { q: 'capture=1&variant=B&tab=pcb&board=flow&view=3d', f: 'variantB-flow-3d.png', c: 'センサ子基板 3D（PMW3901・VL53L1X・1.8 V LDO・JST-SH）' },
    { q: 'capture=1&variant=B&tab=assembly&scenario=G1-3&view=follow&at=9&scale=1', f: 'variantB-fly.png', c: '改良版 B が障害物コースを飛行（屋内・フロー＋ToF）' },
    { q: 'capture=1&variant=B&tab=assembly&drone=designed-gnss&scenario=GB-5b&view=top&scale=25', f: 'variantB-gnss-top.png', c: '屋外 20 m 四方（GNSS）の軌跡：オレンジ破線＝指令、青＝実軌跡（機体は表示 25 倍）' },
  ];
  try {
    for (const s of shots) await shooter.shoot(s.q, `reports/img/${s.f}`);
  } finally {
    await shooter.close();
  }

  // ---------------- charts ----------------
  const hov = outdoor[0].runs[0].sim.samples.filter((s) => s.phase === 'hover');
  const chartHoriz = lineChartSvg({ title: 'GB-5a 屋外ホバリングの水平位置誤差（真値−目標）', xLabel: '時間 [s]', yLabel: '誤差 [m]', series: [{ name: '水平誤差', points: hov.map((s) => [s.t, Math.hypot(s.p.x - s.sp.x, s.p.y - s.sp.y)]) }], refLines: [{ y: OUTDOOR_LIMITS.hoverHoriz, label: '基準' }], yMin: 0 });
  const chartEst = lineChartSvg({ title: 'GB-5a 位置推定誤差（推定−真値、GNSS の変動誤差が支配）', xLabel: '時間 [s]', yLabel: '誤差 [m]', series: [{ name: '推定誤差', points: hov.map((s) => [s.t, Math.hypot(s.estP.x - s.p.x, s.estP.y - s.p.y)]) }], yMin: 0 });
  const sq = outdoor[1].runs[0].sim.samples;
  const chartAlt = lineChartSvg({ title: 'GB-5b 高度（気圧計の変動誤差込み）', xLabel: '時間 [s]', yLabel: '高度 [m]', series: [{ name: '実高度', points: sq.map((s) => [s.t, s.p.z]) }, { name: '目標', points: sq.map((s) => [s.t, s.sp.z]) }] });

  // ---------------- report ----------------
  const massRows = [
    ['全備重量 [g]', fmt(refA.massG, 1), fmt(a.massG, 1)],
    ['フレーム [g]', fmt(refA.frameMassG, 2), fmt(a.frameMassG, 2)],
    ['フロー＋ToF [g]', fmt(refA.items.find((i) => i.name.includes('フロー'))?.massG ?? 0, 2), fmt(flow.massG, 2)],
    ['重心 z [mm]', fmt(refA.cg[2], 2), fmt(a.cg[2], 2)],
    ['電池位置 x [mm]', fmt(refA.battery.x, 1), fmt(a.battery.x, 1)],
    ['Izz [×1e-5 kg m²]', fmt(refA.inertia[8] * 1e-4, 2), fmt(a.inertia[8] * 1e-4, 2)],
    ['GNSS 装着時の全備重量 [g]', '—（端子なし）', fmt(a.massG + GNSS_MODULE.massG, 1)],
  ];
  const html = renderReport({
    stage: 6,
    title: '改良版 B レポート: センサ子基板＋GNSS 端子',
    subtitle: `版 A（既製フローモジュール）を残したまま、フロー＋ToF を自作子基板化し、GNSS 端子を追加した版`,
    generatedAt: nowString(),
    goals,
    sections: [
      {
        title: '版 A からの変更点',
        html: `<ul>
<li><b>センサ子基板</b>（${fd.board.w}×${fd.board.h} mm）を回路から Gerber まで自動生成。PMW3901（1.8 V コアを子基板上の LDO で生成）、VL53L1X、デカップリング、プルアップ、JST-SH 8（メイン J2 と同配列＝1:1 ケーブル）。部品面を床に向けて機首下に M2 ×2 で固定。</li>
<li><b>フレーム B</b>：機首を子基板に合わせて延長（${fmt(a.plate.maxX - a.plate.w / 2, 0)} mm）、子基板の穴位置に合わせた取付穴、ケーブル通し穴（${FRAME_CABLE_SLOT.w}×${FRAME_CABLE_SLOT.l} mm）。</li>
<li><b>メイン基板 B</b>：GNSS＋コンパス用 JST-SH 6（J8：3V3・GND・UART1 TX=IO47/RX=IO48・I²C 共用）を追加。モジュール本体は屋外飛行時のみ装着。</li>
<li><b>シミュレータ</b>：GNSS の誤差を「約 1 m でゆっくり変動する誤差（Gauss–Markov、τ=60 s）」、気圧計の高度ドリフトを同様にモデル化し、屋外シナリオを追加。</li>
<li><b>推定器の修正</b>（版 A にも適用）：姿勢の傾き誤差が観測されない欠陥を発見し、位置フィルタの加速度バイアス推定から傾きを補正する GNSS 補助慣性航法方式に修正。版 A の段階1〜5 は修正後も全合格。</li></ul>`,
      },
      { title: '完成機体 B', html: `<div class="grid2">${shots.map((s) => figure(`img/${s.f}`, s.c)).join('')}</div>` },
      { title: '質量・重心の比較（版 A → 版 B）', html: table(['項目', '版 A', '版 B'], massRows) },
      {
        title: 'センサ子基板',
        html: `<div class="svgbox"><img src="img/variantB-flow-schematic.svg" style="width:100%" alt="子基板回路図"></div>
<div class="grid2">${figure('img/variantB-flow-top.svg', '子基板 上面（部品面）')}${figure('img/variantB-flow-gerber-top.svg', 'Gerber からの独立描画（tracespace）')}</div>
${table(['試行', '基板', 'GND 戦略', '未配線', 'DRC', '結果'], flow.pcb.attempts.map((x) => [x.attempt, x.board, x.gnd, x.unrouted, x.drcViolations, esc(x.note)]))}
<p class="note">小基板では「大きい部品から配置」「コネクタを基板端に固定」「ファンアウト長を含めた占有領域」を有効にした（版 A の配置規則は不変）。24×20 mm〜28×22 mm では配置できず、30×24 mm で成立した。</p>
${table(['参照', '数', '品名', '型番', '要確認'], flow.bom.map((b) => [esc(b.refs.join(', ')), b.qty, esc(b.name), esc(b.mpn), esc(b.verify)]))}
<p class="note">レンズ（${esc(FLOW_BOARD.lens.mpn)}、${FLOW_BOARD.lens.massG} g）は機構部品として別途手配。</p>`,
      },
      { title: 'メイン基板 B（GNSS 端子）', html: `${figure('img/variantB-main-top.svg', 'GNSS の UART（黄）と J8')}${table(['信号', 'GPIO', '備考'], s2.circuit.gpio.map((g) => [esc(g.signal), esc(g.gpio), esc(g.note)]))}${table(['試行', '基板', 'GND 戦略', '未配線', 'DRC', '結果'], s3.pcb.attempts.map((x) => [x.attempt, x.board, x.gnd, x.unrouted, x.drcViolations, esc(x.note)]))}` },
      { title: '屋内飛行（版 B）', html: table(['ID', 'シナリオ', '結果', '判定'], resB.map((r) => [r.id, esc(r.title), esc(r.criteria.map((c) => `${c.label} ${fmt(c.value)}`).join('、')), statusPill(r.pass)])) },
      {
        title: '屋外 GNSS 飛行（GNSS モジュール装着）',
        html: `${table(['シナリオ', '乱数', '主指標', '判定'], outdoor.flatMap((o) => o.runs.map((r, i) => [esc(o.def.title), GNSS_SEEDS[i], esc(r.criteria.map((c) => `${c.label} ${fmt(c.value, 2)}`).join('、')), statusPill(r.pass)])))}
<div class="grid2">${chartHoriz}${chartEst}${chartAlt}</div>
<p class="note">屋外の位置精度は GNSS の精度（約 1 m）で決まる。屋内（フロー＋ToF、数 cm）と同等の精度は RTK 等なしでは得られない。</p>`,
      },
    ],
    concerns: [
      'PMW3901MB・VL53L1X のランドパターンとピン番号は近似。発注前に必ずデータシートで照合すること。PMW3901 はレンズの取付精度が性能を左右する。',
      '子基板は部品面を床に向ける構成のため、着陸時にレンズ・センサが地面に当たらない高さを確保すること（本機は電池下面が最下点）。',
      `屋外飛行は 56〜67 g 級のマイクロ機であり、耐風限界（平均 8 m/s 程度）が低い。屋外運用は微風時に限ること。本格的な屋外機は別途設計する（Class B）。`,
      '100 g 未満の機体でも、小型無人機等飛行禁止法・自治体条例・私有地の管理者の許可などの規制は適用される。',
      'GNSS の磁気センサ（コンパス）はモータ電流の磁界の影響を受ける。モジュールはモータ配線から離し、キャリブレーションを行うこと。',
    ],
  });
  writeText('reports/variantB.html', html);
  writeJson(`${out}/results.json`, { goals, flowBoard: fd.board, mainBoard: s3.pcb.design.board, massG: a.massG, cg: a.cg, outdoor: outdoor.map((o) => ({ id: o.def.id, pass: o.runs.map((r) => r.pass), metrics: o.runs.map((r) => r.criteria.map((c) => c.value)) })) });
  const pass = goals.every((g) => g.pass);
  console.log(`[variantB] ${pass ? 'ALL GOALS PASSED' : 'SOME GOALS FAILED'} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  if (!pass) process.exitCode = 1;
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
