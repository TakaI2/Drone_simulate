/**
 * Overall report (reports/index.html): brushed-up plan, stage goals, final vehicle, how to run.
 */
import { existsSync, readFileSync } from 'node:fs';
import { esc, figure, renderReport, statusPill, table } from '../src/report/html';
import type { GoalRow } from '../src/report/html';
import { REFS } from '../src/report/references';
import { nowString, writeText } from './common';

const STAGES = [
  { n: 1, title: '飛行空間とシミュレーション' },
  { n: 2, title: '推進系サイジングと電気系統設計' },
  { n: 3, title: '部品選定・3D モデル・ブレッドボード・基板設計' },
  { n: 4, title: '機体総合設計' },
  { n: 5, title: '統合（Sim-to-Real）と完成機体' },
];

const loadGoals = (n: number): GoalRow[] => {
  const f = `out/stage${n}/results.json`;
  if (!existsSync(f)) return [];
  const j = JSON.parse(readFileSync(f, 'utf-8')) as { goals?: GoalRow[] };
  return j.goals ?? [];
};

const main = (): void => {
  const all = STAGES.map((s) => ({ ...s, goals: loadGoals(s.n) }));
  const goals: GoalRow[] = all.map((s) => ({
    id: `段階${s.n}`,
    title: s.title,
    criteria: s.goals.map((g) => g.id).join('、') || '—',
    result: `${s.goals.filter((g) => g.pass).length} / ${s.goals.length} 合格`,
    pass: s.goals.length > 0 && s.goals.every((g) => g.pass),
  }));
  const allGoals = all.flatMap((s) => s.goals.map((g) => ({ ...g, stage: s.n })));
  const html = renderReport({
    stage: 0,
    title: 'Drone Design Studio 総合レポート',
    subtitle: '飛行体のシミュレーションから電気・基板・機体設計までを一貫して行うツールと、その初号機（Class A マイクロ・クアッド）',
    generatedAt: nowString(),
    goals,
    sections: [
      {
        title: '完成機体',
        html: `<div class="grid2">${figure('img/stage5-fly-2.png', '完成機体（設計データから組み立てた 3D）が障害物コースを自律飛行')}${figure('img/stage4-iso.png', '完成機体（フレーム・基板・部品・モータ・プロペラ・電池）')}${figure('img/stage3-pcb-3d.png', '自動配置・自動配線したフライトコントローラ基板（40×40 mm、2 層）')}${figure('img/stage1-G1-3-iso.png', '段階1：障害物コースの経路計画と飛行')}</div>`,
      },
      {
        title: 'plan.txt からのブラッシュアップ（要点）',
        html: `<ul>
<li><b>段階の定義</b>：本文 1〜4 とゴール「1〜5」の不一致を解消し、段階5 を「設計値でシミュレーションを再検証し完成機体を表示する統合段階」とした。</li>
<li><b>単一の設計データ</b>：段階1 は参照機で始め、段階2〜4 の結果（質量・慣性・推力係数）を段階5 でシミュレーションに戻す Sim-to-Real ループにした。</li>
<li><b>制御の分担</b>：Raspberry Pi は非リアルタイムのため姿勢制御には使わず、マイコン（ESP32-S3）を FC、Pi はコンパニオン（Class B）とした。</li>
<li><b>ESC</b>：ブラシレス ESC の自作は危険・高難度のため、初号機はブラシ付きコアレス＋MOSFET 直駆動（全ディスクリート）、Class B は市販 AM32 ESC とした。</li>
<li><b>自律飛行の前提</b>：屋内は GPS が使えないため、オプティカルフロー＋ToF で自己位置推定する構成とし、シミュレータにもセンサ誤差を入れた。</li>
<li><b>法規</b>：100 g 未満（模型航空機）を目標に重量を管理（完成機 56.6 g）、無線は技適取得済みモジュールに限定。</li>
<li><b>部品・3D</b>：販売サイトのスクレイピングは規約上行わず検索リンクで対応、「全ディスクリートの 3D」は規格パッケージのパラメトリック生成器として実現。</li>
<li><b>ライセンス</b>：本体は MIT/BSD/Apache 系の依存のみ。GPL（ArduPilot、Betaflight、ESP-Drone、AM32、Freerouting）は設計の参考に留め、コードは取り込んでいない（商用利用に制約なし）。</li></ul>
<p class="note">詳細: <code>.tmp/requirements.md</code>（精査結果と要件）、<code>.tmp/design.md</code>（設計）、<code>.tmp/test_design.md</code>、<code>.tmp/tasks.md</code></p>`,
      },
      {
        title: '全ゴール一覧',
        html: table(['段階', 'ID', 'ゴール', '結果', '判定'], allGoals.map((g) => [`<a href="stage${g.stage}.html">${g.stage}</a>`, esc(g.id), esc(g.title), esc(g.result), statusPill(g.pass)])),
      },
      {
        title: '各段階のレポート',
        html: `<ul>${all.map((s) => `<li><a href="stage${s.n}.html">段階${s.n}：${esc(s.title)}</a>（${s.goals.filter((g) => g.pass).length}/${s.goals.length} 合格）</li>`).join('')}</ul>`,
      },
      {
        title: '使い方',
        html: `<pre>npm install
npm run dev          # UI（http://localhost:5173）: 1 シミュレーション / 2 推進・電気 / 3 部品・基板 / 4 機体 / 5 統合
npm test             # 単体テスト
npm run all          # 段階1〜5 のゴール判定・成果物・レポートを一括生成（Chrome を使って撮影）</pre>
${table(['成果物', '場所'], [
  ['回路図・ネットリスト・BOM', 'out/stage2/（schematic.svg、netlist.net、bom.csv）'],
  ['基板製造データ（Gerber・ドリル）', 'out/stage3/drone_fc_gerber.zip'],
  ['部品実装データ（JLC 形式 BOM・CPL）', 'out/stage3/drone_fc_bom_jlc.csv、drone_fc_cpl.csv'],
  ['KiCad 基板（手修正用）', 'out/stage3/drone_fc.kicad_pcb'],
  ['部品 3D アーカイブ', 'out/parts3d/（STL 47 種＋catalog.json）'],
  ['フレーム STL（3D プリント）', 'out/stage4/frame.stl'],
  ['シミュレーション用パラメータ', 'out/stage5/drone_params.json'],
])}`,
      },
    ],
    concerns: [
      '全段階ともシミュレーションと計算上の検証であり、実機は未製作。推力台での係数測定（段階5 の手順）→ ブレッドボード試験 → 基板発注 → 組立 → 係留試験 → 屋内飛行の順で実機検証を進める必要がある。',
      'LGA センサと無線モジュールのランドパターン、モータ・プロペラ係数は代表値・近似値。発注・製作前に必ずデータシートと実測で確認すること（各レポートの「要確認」）。',
      '実機ファームウェアは本ツールの範囲外（要件と構成のみ段階5 に記載）。',
      '感度解析の結果、推力係数が設計値から 30 % 以上ずれると積分補償が不足する。推力台での係数更新を前提とすること。',
    ],
    references: Object.values(REFS),
  });
  writeText('reports/index.html', html);
  const pass = goals.every((g) => g.pass);
  console.log(`[report] reports/index.html  ${pass ? 'ALL STAGES PASSED' : 'SOME STAGES FAILED'}`);
};

main();
