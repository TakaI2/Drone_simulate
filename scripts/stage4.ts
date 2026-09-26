/**
 * Stage 4: integrated airframe design (frame generation, mass properties, balancing, STL).
 */
import { FRAME_DEFAULTS } from '../src/airframe/design';
import { meshToStl } from '../src/airframe/mesh';
import { runStage2 } from '../src/integration/stage2';
import { airframeSummary, runStage4 } from '../src/integration/stage4';
import { esc, figure, renderReport, statusPill, table } from '../src/report/html';
import { REFS } from '../src/report/references';
import { fmt, nowString, writeJson, writeText } from './common';
import { loadManifold, loadStage3 } from './load';
import { startShooter } from './shot';

const main = async (): Promise<void> => {
  const wasm = await loadManifold();
  const s2 = runStage2({ rotorCount: 4 });
  const s3 = loadStage3();
  const a = runStage4(wasm, s2, s3);
  writeText('out/stage4/frame.stl', meshToStl(a.frame, 'drone-frame'));
  writeJson('out/stage4/airframe.json', airframeSummary(a));

  const byLabel = (l: string) => a.checks.find((c) => c.label.startsWith(l))!;
  const cg = byLabel('重心と推力中心');
  const tip = byLabel('隣接プロペラ');
  const vert = byLabel('プロペラ下面');
  const wt = byLabel('STL の閉じた');
  const auw = byLabel('全備重量');
  const goals = [
    { id: 'G4-1', title: '重心バランス', criteria: '重心と推力中心の水平ずれ < 2 mm', result: `${fmt(cg.value, 3)} mm（${esc(cg.note ?? '')}）`, pass: cg.pass },
    { id: 'G4-2', title: 'プロペラ干渉', criteria: 'プロペラ先端間 ≥ 5 mm かつ 直下構造物との垂直隙間 ≥ 5 mm', result: `先端間 ${fmt(tip.value, 1)} mm、垂直 ${fmt(vert.value, 1)} mm（${esc(vert.note ?? '')}）`, pass: tip.pass && vert.pass },
    { id: 'G4-3', title: 'STL の健全性', criteria: '閉じた多様体（境界辺・非多様体辺・向き不整合 0）', result: `境界 ${a.watertight.boundaryEdges}、非多様体 ${a.watertight.nonManifoldEdges}、向き ${a.watertight.badOrientation}（manifold-3d: ${a.manifoldStatus}）`, pass: wt.pass },
    { id: 'G4-4', title: '全備重量', criteria: '< 100 g（クラスA）', result: `${fmt(auw.value, 1)} g`, pass: auw.pass },
  ];
  for (const g of goals) console.log(`  ${g.id} ${g.pass ? 'PASS' : 'FAIL'} ${g.result}`);

  const shooter = await startShooter();
  const shots = [
    { q: 'capture=1&tab=airframe&view=iso', f: 'stage4-iso.png', c: '完成機体（斜め）：白＝3D プリントフレーム、緑＝基板、青＝電池、赤球＝重心' },
    { q: 'capture=1&tab=airframe&view=top', f: 'stage4-top.png', c: '上面：プロペラ回転面（水色）と基板の重なり、重心と推力軸' },
    { q: 'capture=1&tab=airframe&view=side', f: 'stage4-side.png', c: '側面：プロペラと基板・部品の垂直隙間' },
    { q: 'capture=1&tab=airframe&view=bottom', f: 'stage4-bottom.png', c: '下面：電池（ストラップ固定）とフロー＋ToF モジュール' },
    { q: 'capture=1&tab=airframe&view=iso&frameOnly=1&disks=0&cg=0', f: 'stage4-frame.png', c: '造形するフレーム単体（STL）' },
  ];
  try {
    for (const s of shots) await shooter.shoot(s.q, `reports/img/${s.f}`);
  } finally {
    await shooter.close();
  }

  const F = FRAME_DEFAULTS;
  const html = renderReport({
    stage: 4,
    title: '段階4 レポート: 機体総合設計',
    subtitle: `全備重量 ${fmt(a.massG, 1)} g / フレーム ${fmt(a.frameMassG, 1)} g（PLA、充填率 ${F.printFill * 100} % 相当）`,
    generatedAt: nowString(),
    goals,
    sections: [
      {
        title: '設計内容',
        html: `<ul>
<li>腕長 ${fmt(a.input.armLength, 1)} mm（隣接プロペラ間隙 10 mm から段階2で決定）、腕断面 ${F.armWidth}×${F.armHeight} mm、モータ固定は圧入チューブ（内径 ${fmt(a.input.motor.diameter - 2 * F.tubeFit, 1)} mm＋クランプ用スリット）。</li>
<li>基板は M2 セルフタップで高さ ${F.standoffHeight} mm のスタンドオフに固定（裏面の THT パッドとの隙間確保）。無線モジュールのアンテナは基板後端から張り出し、下にフレーム材がない。</li>
<li>電池は下面に 10 mm 幅ストラップで固定。<b>重心が推力中心に一致する電池位置を反復計算し、その位置に合わせてストラップ用スロットと軽量化穴を配置</b>（設計変数を配置に反映）。</li>
<li>フロー＋ToF モジュールは機首の延長部の下面に M2 で固定（床面を直視）。</li>
<li>フレームは manifold-3d（Apache-2.0）で結合・穴あけし、閉じた多様体として STL 出力。</li></ul>`,
      },
      { title: '完成機体（3D）', html: `<div class="grid2">${shots.map((s) => figure(`img/${s.f}`, s.c)).join('')}</div><p class="note">フレーム STL: <code>out/stage4/frame.stl</code>（${fmt(a.bounds.max[0] - a.bounds.min[0], 1)} × ${fmt(a.bounds.max[1] - a.bounds.min[1], 1)} × ${fmt(a.bounds.max[2] - a.bounds.min[2], 1)} mm、${a.frame.indices.length / 3} 三角形）</p>` },
      {
        title: '重量・重心・慣性',
        html: `${table(['部位', '質量 [g]', '重心位置 x, y, z [mm]'], [...a.items.filter((i) => !i.name.startsWith('部品 ')).map((i) => [esc(i.name), fmt(i.massG, 2), i.center.map((v) => fmt(v, 1)).join(', ')]), ['基板上の部品（' + a.items.filter((i) => i.name.startsWith('部品 ')).length + ' 点）', fmt(a.items.filter((i) => i.name.startsWith('部品 ')).reduce((s, i) => s + i.massG, 0), 2), '個別に位置を考慮'], ['<b>合計</b>', `<b>${fmt(a.massG, 2)}</b>`, `重心 ${a.cg.map((v) => fmt(v, 2)).join(', ')}`]])}
${table(['慣性テンソル（重心まわり）[kg m²]', 'x', 'y', 'z'], [0, 1, 2].map((r) => [['x', 'y', 'z'][r], ...[0, 1, 2].map((c) => (a.inertia[r * 3 + c] * 1e-9).toExponential(3))]))}
<p class="note">段階1の参照機（65 g、Ixx=Iyy=4.0e-5、Izz=7.0e-5 kg m²）との比較は段階5で行う。</p>`,
      },
      {
        title: '重心合わせの反復（試行の繰り返し）',
        html: table(['反復', '電池 x [mm]', '電池 y [mm]', '重心 x [mm]', '重心 y [mm]', '全備重量 [g]'], a.iterations.map((i) => [i.iter, fmt(i.batteryX, 2), fmt(i.batteryY, 2), fmt(i.cgX, 3), fmt(i.cgY, 3), fmt(i.massG, 2)])),
      },
      { title: '検証一覧', html: table(['項目', '値', '基準', '判定', '備考'], a.checks.map((c) => [esc(c.label), `${fmt(c.value, 2)} ${c.unit}`, `${c.op === 'lt' ? '<' : '≥'} ${c.limit} ${c.unit}`, statusPill(c.pass), esc(c.note ?? '')])) },
      {
        title: '造形の目安',
        html: table(['項目', '推奨'], [
          ['材料', 'PLA または PETG（墜落時の割れを嫌う場合は PETG / ナイロン系）'],
          ['向き', '底面（z=0）をベッドに置く。サポート不要（全形状が z=0 から上に立ち上がる）'],
          ['設定', 'ノズル 0.4 mm、積層 0.2 mm、外周 2〜3 周、充填 30〜40 %'],
          ['後加工', 'モータ圧入が固い場合はチューブ内径を 0.05 mm 刻みで調整（FRAME_DEFAULTS.tubeFit）'],
        ]),
      },
    ],
    concerns: [
      '強度は腕付け根の片持ち梁の曲げのみで評価（静的）。墜落時の衝撃、層間剥離、振動（共振）は評価していない。初期試作は PETG を推奨。',
      `プロペラの一部が基板の角の上を通過する（垂直隙間 ${fmt(vert.value, 1)} mm）。プロペラのたわみやモータの傾きで接触しないか実機で確認すること。`,
      'モータ配線（腕に沿わせる）とストラップ、ねじ等の小物は「配線・ねじ等 3 g」として中心付近に一括計上している。',
      '慣性テンソルは部品を直方体・円柱・点で近似したもの。実機では振子法などで Izz を測定して段階5の値を上書きすると精度が上がる。',
      '電池の位置は ±1 mm 程度ずれても重心ずれは約 0.3 mm。個体差で重心がずれた場合はストラップ上で電池を前後させて合わせる。',
    ],
    references: [{ name: 'manifold-3d', url: 'https://github.com/elalish/manifold', license: 'Apache-2.0', usage: 'フレームの多様体ブーリアン演算（依存として取り込み）' }, REFS.three],
  });
  writeText('reports/stage4.html', html);
  writeJson('out/stage4/results.json', { goals, checks: a.checks, massG: a.massG, cg: a.cg, iterations: a.iterations });
  const pass = goals.every((g) => g.pass);
  console.log(`[stage4] ${pass ? 'ALL GOALS PASSED' : 'SOME GOALS FAILED'}`);
  if (!pass) process.exitCode = 1;
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
