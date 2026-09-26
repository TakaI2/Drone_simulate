/**
 * Stage 3: parts catalog mapping, 3D part archive, breadboard layout, PCB auto layout, Gerber/drill output.
 */
import gerberParser from 'gerber-parser';
import pcbStackup from 'pcb-stackup';
import { renderBreadboardSvg } from '../src/electrical/breadboard';
import { runStage2 } from '../src/integration/stage2';
import { runStage3 } from '../src/integration/stage3';
import { buildPartsArchive } from '../src/parts3d/archive';
import { zipStore } from '../src/pcb/gerber';
import { renderPcbSvg } from '../src/pcb/svg';
import { esc, figure, renderReport, statusPill, table } from '../src/report/html';
import { REFS } from '../src/report/references';
import { fmt, nowString, writeJson, writeText } from './common';
import { startShooter } from './shot';

const validateGerber = (name: string, text: string): Promise<{ file: string; objects: number; warnings: string[]; error: string | null }> =>
  new Promise((resolve) => {
    const parser = gerberParser({ filetype: name.endsWith('.drl') ? 'drill' : 'gerber' });
    let objects = 0;
    const warnings: string[] = [];
    parser.on('data', () => objects++);
    parser.on('warning', (w: { message: string }) => warnings.push(w.message));
    parser.on('error', (e: Error) => resolve({ file: name, objects, warnings, error: e.message }));
    parser.on('end', () => resolve({ file: name, objects, warnings, error: null }));
    parser.write(text);
    parser.end();
    parser.resume();
  });

const main = async (): Promise<void> => {
  const t0 = Date.now();
  const s2 = runStage2({ rotorCount: 4 });
  console.log('[stage3] PCB pipeline (placement → routing → pour → DRC)…');
  const s3 = runStage3(s2);
  const d = s3.pcb.design;
  console.log(`  board ${d.board.w}×${d.board.h} mm, attempts ${s3.pcb.attempts.length}, success ${s3.pcb.success}`);

  // ---------- fabrication outputs ----------
  for (const [name, text] of Object.entries(s3.gerbers.files)) writeText(`out/stage3/gerber/${name}`, text);
  writeText('out/stage3/drone_fc_gerber.zip', zipStore(s3.gerbers.files));
  writeText('out/stage3/drone_fc_cpl.csv', s3.gerbers.cpl);
  const jlcBom = ['Comment,Designator,Footprint,Manufacturer Part'];
  for (const b of s2.bom) if (b.mpn !== '—') jlcBom.push(`"${b.value}","${b.refs.join(',')}",${b.package},"${b.mpn}"`);
  writeText('out/stage3/drone_fc_bom_jlc.csv', jlcBom.join('\r\n') + '\r\n');
  writeText('out/stage3/drone_fc.kicad_pcb', s3.kicad);
  writeJson('out/stage3/pcb.json', { design: d, stats: s3.pcb.stats, drc: { counts: s3.pcb.drc.counts, violations: s3.pcb.drc.violations.slice(0, 50) }, attempts: s3.pcb.attempts });
  const topSvg = renderPcbSvg(d, { scale: 20, title: `上面（F.Cu）${d.board.w}×${d.board.h} mm` });
  const botSvg = renderPcbSvg(d, { scale: 20, layers: ['B'], title: '下面（B.Cu）' });
  writeText('reports/img/stage3-pcb-top.svg', topSvg);
  writeText('reports/img/stage3-pcb-bottom.svg', botSvg);
  const bbSvg = renderBreadboardSvg(s3.breadboard);
  writeText('out/stage3/breadboard.svg', bbSvg);
  writeText('reports/img/stage3-breadboard.svg', bbSvg);

  // ---------- independent Gerber validation ----------
  console.log('[stage3] validating Gerber / Excellon with tracespace parsers…');
  const validations = await Promise.all(Object.entries(s3.gerbers.files).map(([n, t]) => validateGerber(n, t)));
  const stackup = await pcbStackup(Object.entries(s3.gerbers.files).map(([filename, gerber]) => ({ filename, gerber })), { outlineGapFill: 0.05 });
  writeText('reports/img/stage3-gerber-top.svg', stackup.top.svg);
  writeText('reports/img/stage3-gerber-bottom.svg', stackup.bottom.svg);
  const identified = stackup.layers.map((l) => `${l.filename} → ${l.side ?? '-'}/${l.type ?? '-'}`);

  // ---------- 3D archive ----------
  console.log('[stage3] exporting 3D part archive…');
  const archive = buildPartsArchive();
  for (const [f, bytes] of Object.entries(archive.files)) writeText(`out/parts3d/${f}`, bytes);
  writeJson('out/parts3d/catalog.json', { generated: nowString(), units: 'mm', entries: archive.entries });

  // ---------- goals ----------
  const purch = s3.mapping.filter((m) => m.mpn !== '—');
  const g1 = s3.mapping.every((m) => m.hasDims && m.hasMass) && purch.every((m) => m.vendors.length > 0);
  const g2 = s3.mapping.every((m) => m.has3d);
  const unrouted = d.unrouted.length;
  const drcCount = s3.pcb.drc.violations.length;
  const gerberErrors = validations.filter((v) => v.error).length;
  const expectedLayers = ['F_Cu', 'B_Cu', 'F_Mask', 'B_Mask', 'F_Silkscreen', 'F_Paste', 'Edge_Cuts', 'PTH', 'NPTH'];
  const haveAll = expectedLayers.every((k) => Object.keys(s3.gerbers.files).some((f) => f.includes(k)));
  const goals = [
    { id: 'G3-1', title: '部品カタログ対応', criteria: 'BOM 全部品が寸法・重量を持ち、購入品は購入先リンクを持つ', result: `${s3.mapping.length} 品目中 寸法/重量 ${s3.mapping.filter((m) => m.hasDims && m.hasMass).length}、購入先 ${purch.filter((m) => m.vendors.length).length}/${purch.length}`, pass: g1 },
    { id: 'G3-2', title: '3D モデル', criteria: '使用する全パッケージの 3D モデルを生成', result: `使用 ${new Set(s3.mapping.map((m) => m.package)).size} 種すべて生成、アーカイブ ${archive.entries.length} 種`, pass: g2 },
    { id: 'G3-3', title: '全ネット配線', criteria: '未配線 0', result: `未配線 ${unrouted}（トラック ${d.tracks.length} 本、ビア ${d.vias.length} 個）`, pass: unrouted === 0 },
    { id: 'G3-4', title: 'DRC', criteria: 'クリアランス・線幅・穴径・基板端・穴間・導通の違反 0', result: `違反 ${drcCount}（検査ペア ${s3.pcb.drc.checkedPairs.toLocaleString()}）`, pass: drcCount === 0 },
    { id: 'G3-5', title: '製造データ', criteria: 'Gerber 7 層＋ドリル 2 ファイルを出力し、独立パーサで構文エラー 0', result: `${Object.keys(s3.gerbers.files).length} ファイル、構文エラー ${gerberErrors}`, pass: haveAll && gerberErrors === 0 },
    { id: 'G3-6', title: 'ブレッドボード配置', criteria: '列の衝突・未導通・誤接続 0', result: s3.breadboard.checks.map((c) => `${c.pass ? '✓' : '✗'}${c.detail}`).join('、'), pass: s3.breadboard.pass },
  ];
  for (const g of goals) console.log(`  ${g.id} ${g.pass ? 'PASS' : 'FAIL'} ${g.result}`);

  // ---------- screenshots ----------
  const shooter = await startShooter();
  try {
    await shooter.shoot('capture=1&tab=pcb&view=3d', 'reports/img/stage3-pcb-3d.png');
    await shooter.shoot('capture=1&tab=pcb&view=3d-bottom', 'reports/img/stage3-pcb-3d-bottom.png');
    await shooter.shoot('capture=1&tab=pcb&view=lib', 'reports/img/stage3-lib.png');
    await shooter.shoot('tab=pcb&view=2d', 'reports/img/stage3-ui.png');
  } finally {
    await shooter.close();
  }

  // ---------- report ----------
  const st = s3.pcb.stats;
  const html = renderReport({
    stage: 3,
    title: '段階3 レポート: 部品選定・3D モデル・ブレッドボード・基板設計',
    subtitle: `基板 ${d.board.w}×${d.board.h} mm 2 層 t=${d.rules.boardThickness} mm、部品 ${d.placements.length} 点`,
    generatedAt: nowString(),
    goals,
    sections: [
      {
        title: '基板設計の流れ',
        html: `<ol>
<li><b>配置</b>: 取付穴・無線モジュール（アンテナを基板外へ張り出し）・電池パッド・モータパッド（各アームの方向）を固定し、残りを接続先への距離が最小になる位置へ 4 方向の回転を試しながら貪欲配置。デカップリングは対応 IC の近くへ。</li>
<li><b>ファンアウト</b>: 0.5 mm ピッチの LGA（IMU・気圧センサ）は各ピンを外側へ扇状に引き出してから配線（中央のピンから順に配線して囲い込みを防ぐ）。センサ直下は配線・ビア禁止。</li>
<li><b>配線</b>: 0.05 mm グリッドの 2 層 A*。他ネット銅箔＋クリアランスの距離変換で線幅ぶん膨張させて通行判定し、層変更はビア（コスト付き）。見通し判定で経路を短縮。</li>
<li><b>GND</b>: GND 島を配線で連結 → 両面ベタ → スティッチングビア（${d.rules.stitchPitch} mm 格子）→ 電池 GND に繋がらない孤島を削除。MOSFET ドレインには放熱銅箔＋サーマルビア、モジュールの EPAD にはサーマルビア 9 本。</li>
<li><b>DRC</b>: ラスタではなく厳密な幾何（線分・円・矩形の距離）で全銅箔ペアを検査し、導通は union-find で確認。</li>
<li><b>試行</b>: 基板寸法 × GND 戦略 × リップアップ（失敗ネットを優先して再配線）を順に試し、最初に全合格した案を採用。</li></ol>`,
      },
      {
        title: '試行の繰り返し（配置・配線）',
        html: table(['試行', '基板', 'GND 戦略', '優先ネット', '未配線', 'DRC 違反', 'トラック', 'ビア', '時間 [ms]', '結果'], s3.pcb.attempts.map((a) => [a.attempt, a.board, a.gnd, esc(a.priority.join(', ') || '—'), a.unrouted, a.drcViolations, a.tracks, a.vias, a.timeMs, esc(a.note)])),
      },
      {
        title: '基板（生成データ）',
        html: `<div class="grid2">${figure('img/stage3-pcb-top.svg', '上面：赤＝F.Cu 配線、薄赤＝GND ベタ、濃赤＝放熱銅箔、黄＝パッド、灰＝ビア、黄破線＝アンテナ禁止領域')}${figure('img/stage3-pcb-bottom.svg', '下面：青＝B.Cu 配線、薄青＝GND ベタ（ほぼ全面をリターンパスとして確保）')}</div>
${table(['項目', '値'], [
  ['配線長合計', `${fmt(st.trackLengthMm, 0)} mm`],
  ['ビア', Object.entries(st.viaCount).map(([k, v]) => `${k}: ${v}`).join('、')],
  ['GND ベタ面積', `上面 ${fmt(st.pourAreaMm2.F, 0)} mm²、下面 ${fmt(st.pourAreaMm2.B, 0)} mm²`],
  ['ネックダウン（細線化）', st.neckdowns.length ? st.neckdowns.map((n) => `${n.net}→${n.width} mm`).join('、') : 'なし'],
  ['設計ルール', `クリアランス ${d.rules.clearance} mm、信号線 ${d.rules.trackWidth.signal} mm、3.3 V ${d.rules.trackWidth.power3v3} mm、モータ ${d.rules.trackWidth.motor} mm、VBAT ${d.rules.trackWidth.vbat} mm、ビア φ${d.rules.viaDiameter}/${d.rules.viaDrill} mm`],
  ['基板質量（推定）', `${fmt(s3.boardMassG, 2)} g（部品込み電子回路 ${fmt(s3.electronicsMassG, 2)} g）`],
])}`,
      },
      {
        title: 'Gerber からの独立レンダリング（tracespace）',
        html: `<p class="note">出力した Gerber / Excellon を tracespace（MIT）の pcb-stackup で描画した結果。自作レンダラとは独立なので、ファイル自体の正しさの確認になる。</p><div class="grid2">${figure('img/stage3-gerber-top.svg', 'Gerber 描画（上面）')}${figure('img/stage3-gerber-bottom.svg', 'Gerber 描画（下面）')}</div>
${table(['ファイル', '解析オブジェクト数', '警告', 'エラー'], validations.map((v) => [esc(v.file), v.objects, esc(v.warnings.slice(0, 3).join(' / ') || '0'), v.error ? esc(v.error) : '0']))}
<p class="note">層の自動判別（whats-that-gerber）: ${esc(identified.join('、'))}</p>
<p class="note">入稿ファイル: <code>out/stage3/drone_fc_gerber.zip</code>（JLCPCB / PCBWay / Elecrow など）、部品実装用: <code>drone_fc_bom_jlc.csv</code>、<code>drone_fc_cpl.csv</code>、KiCad で開いて修正: <code>drone_fc.kicad_pcb</code>（GND ゾーンは B キーで再充填）</p>`,
      },
      { title: '実装済み基板の 3D', html: `<div class="grid2">${figure('img/stage3-pcb-3d.png', '上面側')}${figure('img/stage3-pcb-3d-bottom.png', '下面側')}</div>` },
      {
        title: '部品カタログ対応（BOM → 製品）',
        html: table(['参照', '数', '型番', 'メーカ', 'パッケージ', '寸法 L×W×H [mm]', '質量 [g]', '3D', '代替', '購入先', '要確認'], s3.mapping.map((m) => [
          esc(m.refs), m.qty, esc(m.mpn), esc(m.manufacturer), esc(m.package), m.dims.join('×'), fmt(m.massG, 3), m.has3d ? '✓' : '✗', m.alternatives,
          m.vendors.map((v) => `<a href="${v.url}">${esc(v.vendor)}</a>`).join(' ') || '—', esc(m.verify),
        ])),
      },
      {
        title: '3D 部品アーカイブ',
        html: `${figure('img/stage3-lib.png', 'パッケージ 3D ライブラリ（UI）')}<p class="note">保存先: <code>out/parts3d/*.stl</code> と <code>catalog.json</code>。寸法を入れ替えれば同系統の任意部品を生成できる（パラメトリック）。</p>${table(['ID', '系統', '説明', '規格・出典', 'パッド数', '外形 [mm]', '高さ [mm]', '要確認'], archive.entries.map((e) => [esc(e.id), esc(e.family), esc(e.description), esc(e.standard), e.pads, e.courtyardMm.join('×'), fmt(e.heightMm, 2), e.verify ? '⚠' : '']))}`,
      },
      {
        title: 'ブレッドボード配置（試作・動作確認用）',
        html: `<div class="svgbox"><img src="img/stage3-breadboard.svg" style="width:100%" alt="ブレッドボード"></div>${table(['検証項目', '判定', '詳細'], s3.breadboard.checks.map((c) => [esc(c.label), statusPill(c.pass), esc(c.detail)]))}${table(['部材', '数量', '備考'], s3.breadboard.bom.map((b) => [esc(b.item), b.qty, esc(b.note)]))}`,
      },
      { title: 'UI', html: figure('img/stage3-ui.png', '部品・基板タブ') },
    ],
    concerns: [
      'IMU（ICM-42688-P）・気圧センサ（BMP390）・ESP32-S3 モジュールのランドパターンは近似。発注前に各データシートの推奨ランドとピン配置を必ず照合すること（カタログの「要確認」欄）。',
      '自動配線は全ネット接続と DRC を満たしているが、高速信号（SPI 10 MHz 程度）の等長やリターンパス、モータ電流ループ面積の最小化までは最適化していない。KiCad で目視確認し、必要なら手修正する。',
      '無線モジュール直下の上面は配線禁止とし、アンテナは基板外へ張り出させた。フレーム設計（段階4）でアンテナ付近に金属・カーボンを置かないこと。',
      'VBAT 幹線は 1.0 mm 幅。全開時の分岐電流（最大約 4 A）では温度上昇が 10 °C を超える可能性がある。2 oz 銅箔の指定、または露出させてはんだを盛る対策を推奨。',
      'GND ベタには THT パッドへのサーマルリリーフを入れていない（手はんだ時に熱が逃げやすい）。',
      'モジュール EPAD 内のサーマルビアはテンティング前提。リフロー時のはんだ吸い込みが気になる場合はビア充填（有償オプション）を指定する。',
      '販売サイトの価格・在庫は取得していない（検索リンクのみ）。',
    ],
    references: [REFS.kicad3d, REFS.freerouting, REFS.gerber, REFS.skidl, REFS.three, { name: 'tracespace（gerber-parser / pcb-stackup）', url: 'https://github.com/tracespace/tracespace', license: 'MIT', usage: '出力 Gerber の独立検証・描画（開発用依存）' }],
  });
  writeText('reports/stage3.html', html);
  writeJson('out/stage3/results.json', { goals, board: d.board, attempts: s3.pcb.attempts, stats: st, validations, breadboard: s3.breadboard.checks });
  const pass = goals.every((g) => g.pass);
  console.log(`[stage3] ${pass ? 'ALL GOALS PASSED' : 'SOME GOALS FAILED'} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  if (!pass) process.exitCode = 1;
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
