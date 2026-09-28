/** Budget of variants A/B/C from the BOMs and the reference price table (reports/budget.html). */
import { readFileSync } from 'node:fs';
import { computeBudget, usedPrices } from '../src/budget/budget';
import type { BudgetInput, BudgetLine, BudgetResult, Range } from '../src/budget/budget';
import { BUDGET_SETTINGS, PCB_ORDER } from '../src/budget/prices';
import { generateCircuit } from '../src/electrical/circuit';
import { buildBom } from '../src/electrical/export';
import { generateFlowBoard } from '../src/electrical/flowboard';
import { runStage2 } from '../src/integration/stage2';
import { esc, renderReport, table } from '../src/report/html';
import { nowString, writeJson, writeText } from './common';

const JPY = BUDGET_SETTINGS.usdJpy;
const yen = (usd: number): string => `${(Math.round((usd * JPY) / 100) * 100).toLocaleString('ja-JP')} 円`;
/** Line items: yen to the unit (small parts cost a few yen). */
const yen1 = (usd: number): string => `${Math.round(usd * JPY).toLocaleString('ja-JP')} 円`;
const yenRange = (r: Range): string => `${yen(r.usd)}（${yen(r.low)}〜${yen(r.high)}）`;
const usd = (v: number): string => `$${v < 1 ? v.toFixed(3) : v.toFixed(2)}`;

const COMMON_HW = [{ id: 'screws-m2', qty: 1 }, { id: 'battery-strap', qty: 1 }, { id: 'wire-misc', qty: 1 }];

const main = (): void => {
  const a = runStage2({ rotorCount: 4 });
  const b = runStage2({ rotorCount: 4, gnssConnector: true });
  const cBom = buildBom(generateCircuit({ rotorCount: 4, gnssConnector: true, power: 'buck', motorDrive: 'esc' }));
  const cChoice = (JSON.parse(readFileSync('out/variantC/results.json', 'utf-8')) as { sizing: { choice: string } }).sizing.choice.split(' / ');
  const frame = (f: string): number => (JSON.parse(readFileSync(f, 'utf-8')) as { frameMassG: number }).frameMassG;

  const inputs: BudgetInput[] = [
    {
      variant: 'A', title: '版 A（1S ブラシ付き・既製フローモジュール）',
      boards: [{ name: 'FC 基板', bom: a.bom }], rotors: 4,
      motorId: a.sizing.input.motor.id, propId: a.sizing.input.prop.id, batteryId: a.sizing.input.battery.id, propsIncludedWithMotors: true,
      modules: [{ id: 'FlowToF-Module', qty: 1 }], frameMassG: frame('out/stage4/airframe.json'),
      hardware: COMMON_HW, tools: ['charger-1s', 'usb-uart', 'pogo-jig', 'lipo-bag'],
    },
    {
      variant: 'B', title: '版 B（センサ子基板＋GNSS）',
      boards: [{ name: 'メイン基板 B', bom: b.bom }, { name: 'センサ子基板', bom: buildBom(generateFlowBoard()) }], rotors: 4,
      motorId: b.sizing.input.motor.id, propId: b.sizing.input.prop.id, batteryId: b.sizing.input.battery.id, propsIncludedWithMotors: true,
      modules: [{ id: 'flow-lens', qty: 1 }, { id: 'GNSS-M10', qty: 1 }], frameMassG: frame('out/variantB/airframe.json'),
      hardware: [...COMMON_HW, { id: 'jst-sh-cable', qty: 1 }], tools: ['charger-1s', 'usb-uart', 'pogo-jig', 'lipo-bag'],
    },
    {
      variant: 'C', title: '版 C（屋外機：ブラシレス 2S・GNSS）',
      boards: [{ name: 'FC 基板 C', bom: cBom }], rotors: 4,
      motorId: cChoice[0], propId: cChoice[1], batteryId: cChoice[2],
      modules: [{ id: 'ESC-4in1-AM32', qty: 1 }, { id: 'GNSS-M10', qty: 1 }], frameMassG: frame('out/variantC/airframe.json'),
      hardware: [...COMMON_HW, { id: 'xt30-pigtail', qty: 1 }, { id: 'jst-sh-cable', qty: 1 }], tools: ['charger-2s', 'usb-uart', 'pogo-jig', 'lipo-bag'],
    },
  ];
  const results = inputs.map(computeBudget);
  const missing = results.flatMap((r) => r.missing);

  // ---------------- tables ----------------
  const lineRows = (ls: BudgetLine[]): Array<Array<string | number>> =>
    ls.map((l) => [esc(l.group), esc(l.item), Number.isInteger(l.qty) ? l.qty : l.qty.toFixed(3), usd(l.unitUsd), yen1(l.totalUsd), `${yen1(l.totalLowUsd)}〜${yen1(l.totalHighUsd)}`, l.basis === 'web' ? 'Web 確認' : l.basis === 'estimate' ? '推定' : '計算']);
  const byGroup = (r: BudgetResult): Array<[string, number]> => {
    const m = new Map<string, number>();
    for (const l of r.perVehicle) {
      const g = l.group.startsWith('基板部品') ? '基板部品' : l.group;
      m.set(g, (m.get(g) ?? 0) + l.totalUsd);
    }
    return [...m.entries()].sort((x, y) => y[1] - x[1]);
  };
  const barSvg = (rows: Array<[string, number]>, title: string): string => {
    const W = 560, rowH = 26, pad = 150, max = Math.max(...rows.map((r) => r[1]));
    const bars = rows.map(([k, v], i) => {
      const wBar = ((W - pad - 90) * v) / max;
      return `<text x="${pad - 8}" y="${34 + i * rowH + 13}" font-size="12" text-anchor="end" fill="#52514e">${esc(k)}</text><rect x="${pad}" y="${34 + i * rowH}" width="${wBar.toFixed(1)}" height="18" rx="2" fill="#2a78d6"/><text x="${pad + wBar + 6}" y="${34 + i * rowH + 13}" font-size="12" fill="#0b0b0b">${yen(v)}</text>`;
    }).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${40 + rows.length * rowH}" width="100%" style="max-width:${W}px;font-family:system-ui,sans-serif"><text x="0" y="16" font-size="13" font-weight="600" fill="#0b0b0b">${esc(title)}</text>${bars}</svg>`;
  };
  const summary = table(['版', '1 機分の部品代', '初回に必要な費用（基板ロット・送料・税・予備込み）', '道具（初回のみ）'], results.map((r) => [esc(r.input.title), yenRange(r.totals.perVehicle), yenRange(r.totals.firstBuild), yenRange(r.totals.tools)]));
  const ids = new Set<string>();
  for (const inp of inputs) {
    for (const bd of inp.boards) for (const x of bd.bom) ids.add(x.partId);
    [inp.motorId, inp.propId, inp.batteryId, 'PLA', ...inp.modules.map((m) => m.id), ...inp.hardware.map((h) => h.id), ...inp.tools].forEach((i) => ids.add(i));
  }
  const priceTable = table(['品目', '単価（目安）', '幅', '単位', '根拠', '参照元', '確認日'], usedPrices([...ids]).filter(([, p]) => p.usd > 0).map(([id, p]) => [
    esc(id), usd(p.usd), `${usd(p.low)}〜${usd(p.high)}`, esc(p.unit), p.basis === 'web' ? 'Web 確認' : '推定',
    p.url ? `<a href="${p.url}" target="_blank" rel="noopener">${esc(p.source)}</a>` : esc(p.source), p.checked,
  ]));
  const notes = usedPrices([...ids]).filter(([, p]) => p.note).map(([id, p]) => `<li><b>${esc(id)}</b>：${esc(p.note ?? '')}</li>`).join('');

  const goals = [
    { id: 'GP-1', title: '価格の付与', criteria: '版 A・B・C の BOM の全品目に価格がある', result: missing.length ? `価格なし: ${missing.join(', ')}` : '全品目に価格あり', pass: missing.length === 0 },
    { id: 'GP-2', title: '予算の出力', criteria: '各版の 1 機分・初回費用・道具と内訳、価格幅', result: results.map((r) => `${r.input.variant} ${yen(r.totals.perVehicle.usd)} / 初回 ${yen(r.totals.firstBuild.usd)}`).join('、'), pass: results.every((r) => r.perVehicle.length > 0 && r.firstBuild.length > 0) },
  ];
  const html = renderReport({
    stage: 9,
    title: '予算（部品価格）',
    subtitle: `版 A・B・C の部品代と初回費用。為替 1 USD = ${JPY} 円（2026-09-28）、輸入消費税 ${BUDGET_SETTINGS.consumptionTax * 100} %`,
    generatedAt: nowString(),
    goals,
    sections: [
      {
        title: 'まとめ',
        html: `${summary}
<div class="grid2">${results.map((r) => barSvg(byGroup(r), `${r.input.title}：1 機分の内訳`)).join('')}</div>
<ul>
<li><b>1 機分の部品代</b>：2 機目以降の目安（基板の段取り費などの固定費を含まない材料費）。電池は 1 本。</li>
<li><b>初回に必要な費用</b>：基板は JLCPCB 相当で製造 ${PCB_ORDER.boardsOrdered} 枚・実装 ${PCB_ORDER.boardsAssembled} 枚、電池 ${BUDGET_SETTINGS.batteriesPerVehicle} 本、プロペラ予備 ${BUDGET_SETTINGS.spares.propsSets} セット、PLA 1 巻、送料、輸入消費税を含む。実装した 2 枚目の基板は予備になる。</li>
<li><b>道具</b>：充電器、書込み用 USB-シリアルとポゴピン治具、LiPo 保管袋。3D プリンタとはんだごては手持ち前提（外部の造形サービスを使う場合はフレーム 1 個あたり数千円）。</li>
<li>価格幅は、Web で確認した価格の範囲、または推定値の幅。国内通販で買うと、海外価格より 1.3〜2 倍程度高いことが多い。</li></ul>`,
      },
      ...results.map((r) => ({
        title: `${r.input.title} の内訳`,
        html: `<h3>1 機分：${yenRange(r.totals.perVehicle)}</h3>${table(['区分', '品目', '数量', '単価', '金額', '幅', '根拠'], lineRows(r.perVehicle))}
<h3>初回に必要な費用：${yenRange(r.totals.firstBuild)}</h3>${table(['区分', '品目', '数量', '単価', '金額', '幅', '根拠'], lineRows(r.firstBuild))}
<p class="note">基板：${r.pcb.map((p) => `${esc(p.board)} はんだ付け ${p.joints} 点・拡張部品 ${p.extendedTypes} 種・部品 ${usd(p.partsUsd)}/枚`).join('、')}</p>
<h3>道具：${yenRange(r.totals.tools)}</h3>${table(['区分', '品目', '数量', '単価', '金額', '幅', '根拠'], lineRows(r.tools))}`,
      })),
      { title: '価格表（参照元・確認日）', html: `${priceTable}${notes ? `<h3>価格調査で分かった注意点</h3><ul>${notes}</ul>` : ''}<p class="note">価格は 2026-09-28 に Web 検索で個別に確認した値（販売サイトの自動収集はしていない）。確認できなかった品目は一般的な価格からの推定値。発注前に最新価格・在庫・送料を確認すること。価格は <code>src/budget/prices.ts</code> で更新できる。</p>` },
    ],
    concerns: [
      '価格・在庫・為替・送料は変動する。特に ICM-42688-P と BMP390 は在庫が不安定（代替品の検討が必要な場合がある）。',
      '版 C の ESC：単体の小型 12 A・AM32 品は市場にほとんどなく、同クラスは Bluejay（BLHeli_S 系）が主流。DShot 対応なら回路は変更不要だが、電流センサの有無・ハーネスのピン順・質量（4.5 g 想定）を製品に合わせて確認すること。',
      'GNSS モジュール：市販の M10＋コンパス品は 7.7 g 前後で、版 C の設計値（5 g）より重い。そのまま使うと全備重量が約 96 g になり、100 g までの余裕が 3 g 台に減る。',
      'JLCPCB の実装費は注文時の見積もりで確定する（拡張部品のフィーダ費は $3 から $1.5 に値下げされたとの情報があり、変動している）。',
      '輸入時の消費税・通関手数料は配送業者によって異なる。個人輸入の少額免税（課税価格 1 万円以下）が適用される場合もある。',
    ],
  });
  writeText('reports/budget.html', html);
  writeJson('out/budget/budget.json', { settings: BUDGET_SETTINGS, pcbOrder: PCB_ORDER, results: results.map((r) => ({ variant: r.input.variant, title: r.input.title, totals: r.totals, perVehicle: r.perVehicle, firstBuild: r.firstBuild, tools: r.tools, pcb: r.pcb })), goals });
  const csv = ['variant,section,group,item,qty,unit_usd,total_usd,total_jpy,basis,source'];
  for (const r of results)
    for (const [sec, ls] of [['per_vehicle', r.perVehicle], ['first_build', r.firstBuild], ['tools', r.tools]] as Array<[string, BudgetLine[]]>)
      for (const l of ls) csv.push([r.input.variant, sec, l.group, l.item, l.qty, l.unitUsd, l.totalUsd.toFixed(3), Math.round(l.totalUsd * JPY), l.basis, l.source].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','));
  writeText('out/budget/budget.csv', `﻿${csv.join('\r\n')}\r\n`);
  for (const r of results) console.log(`[budget] ${r.input.variant}: 1 機 ${yenRange(r.totals.perVehicle)} / 初回 ${yenRange(r.totals.firstBuild)} / 道具 ${yenRange(r.totals.tools)}`);
  for (const g of goals) console.log(`  ${g.id} ${g.pass ? 'PASS' : 'FAIL'} ${g.result}`);
  if (!goals.every((g) => g.pass)) process.exitCode = 1;
};

main();
