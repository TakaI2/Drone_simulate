import { findPart } from '../electrical/catalog';
import type { BomLine } from '../electrical/export';
import { getPackage } from '../parts3d/packages';
import { BUDGET_SETTINGS, PCB_ORDER, PRICES, priceOf } from './prices';
import type { PriceRecord } from './prices';

export interface BudgetBoard {
  name: string;
  bom: BomLine[];
}

export interface BudgetInput {
  variant: string;
  title: string;
  boards: BudgetBoard[];
  rotors: number;
  motorId: string;
  propId: string;
  batteryId: string;
  /** Motors sold with props (brushed sets): props of the first set are included. */
  propsIncludedWithMotors?: boolean;
  /** Off-board modules (ESC, GNSS, flow breakout, lens) with quantities. */
  modules: Array<{ id: string; qty: number }>;
  frameMassG: number;
  hardware: Array<{ id: string; qty: number }>;
  tools: string[];
}

export interface BudgetLine {
  group: string;
  item: string;
  qty: number;
  unitUsd: number;
  lowUsd: number;
  highUsd: number;
  totalUsd: number;
  totalLowUsd: number;
  totalHighUsd: number;
  basis: 'web' | 'estimate' | 'calc';
  source: string;
  url?: string;
}

export interface BudgetResult {
  input: BudgetInput;
  /** Material cost of one vehicle (parts only, no fixed fees). */
  perVehicle: BudgetLine[];
  /** First build: minimum orders, fees, shipping, tax, spares. */
  firstBuild: BudgetLine[];
  tools: BudgetLine[];
  totals: { perVehicle: Range; firstBuild: Range; tools: Range };
  missing: string[];
  pcb: Array<{ board: string; joints: number; extendedTypes: number; partsUsd: number }>;
}

export interface Range {
  usd: number;
  low: number;
  high: number;
}

const line = (group: string, item: string, qty: number, p: PriceRecord): BudgetLine => ({
  group, item, qty,
  unitUsd: p.usd, lowUsd: p.low, highUsd: p.high,
  totalUsd: qty * p.usd, totalLowUsd: qty * p.low, totalHighUsd: qty * p.high,
  basis: p.basis, source: p.source, url: p.url,
});

const calc = (group: string, item: string, usd: number, source: string, spread = 0.2): BudgetLine => ({
  group, item, qty: 1, unitUsd: usd, lowUsd: usd * (1 - spread), highUsd: usd * (1 + spread),
  totalUsd: usd, totalLowUsd: usd * (1 - spread), totalHighUsd: usd * (1 + spread), basis: 'calc', source,
});

const sum = (ls: BudgetLine[]): Range => ({ usd: ls.reduce((s, l) => s + l.totalUsd, 0), low: ls.reduce((s, l) => s + l.totalLowUsd, 0), high: ls.reduce((s, l) => s + l.totalHighUsd, 0) });

/** Parts on a board that are actually placed (pads, holes and test pads are free). */
const assembled = (b: BomLine): boolean => (priceOf(b.partId)?.usd ?? 1) > 0 && b.package !== 'external';

export const computeBudget = (inp: BudgetInput): BudgetResult => {
  const missing: string[] = [];
  const need = (id: string): PriceRecord => {
    const p = priceOf(id);
    if (!p) {
      missing.push(id);
      return { usd: 0, low: 0, high: 0, unit: '', perUnit: 1, basis: 'estimate', source: '価格なし', checked: '' };
    }
    return p;
  };
  const S = BUDGET_SETTINGS;
  const perVehicle: BudgetLine[] = [];
  const firstBuild: BudgetLine[] = [];
  const pcb: BudgetResult['pcb'] = [];

  // ---------------- boards ----------------
  let hasModule = false;
  for (const b of inp.boards) {
    const lines = b.bom.filter(assembled).map((x) => line(`基板部品（${b.name}）`, `${x.name}（${x.refs.join(', ')}）`, x.qty, need(x.partId)));
    perVehicle.push(...lines);
    const partsUsd = lines.reduce((s, l) => s + l.totalUsd, 0);
    const joints = b.bom.filter(assembled).reduce((s, x) => {
      try {
        return s + x.qty * getPackage(findPart(x.partId).package).pads.length;
      } catch {
        return s;
      }
    }, 0);
    const extendedTypes = b.bom.filter(assembled).filter((x) => priceOf(x.partId)?.jlc === 'extended').length;
    hasModule ||= b.bom.some((x) => findPart(x.partId).category === 'mcu');
    pcb.push({ board: b.name, joints, extendedTypes, partsUsd });
    const O = PCB_ORDER;
    const setup = hasModule && b.bom.some((x) => findPart(x.partId).category === 'mcu') ? O.setupStandard : O.setupEconomic;
    firstBuild.push(
      calc(`基板発注（${b.name}）`, `基板製造 ${O.boardsOrdered} 枚（2 層）`, O.fabrication, O.source),
      calc(`基板発注（${b.name}）`, `実装の段取り・ステンシル・技術料（${setup === O.setupStandard ? 'Standard PCBA：モジュールあり' : 'Economic PCBA'}）`, setup + O.stencil + O.engineering, O.source),
      calc(`基板発注（${b.name}）`, `拡張部品のフィーダ費（${extendedTypes} 種 × $${O.extendedFee}）`, extendedTypes * O.extendedFee, O.source),
      calc(`基板発注（${b.name}）`, `はんだ付け（${joints} 点 × ${O.boardsAssembled} 枚）`, joints * O.perJoint * O.boardsAssembled, O.source),
      { ...calc(`基板発注（${b.name}）`, `実装部品（${O.boardsAssembled} 枚分）`, partsUsd * O.boardsAssembled, '上の部品単価の合計 × 実装枚数', 0), totalLowUsd: lines.reduce((s, l) => s + l.totalLowUsd, 0) * O.boardsAssembled, totalHighUsd: lines.reduce((s, l) => s + l.totalHighUsd, 0) * O.boardsAssembled },
    );
  }
  if (inp.boards.length) firstBuild.push(calc('基板発注', '国際送料（基板・1 回にまとめる）', PCB_ORDER.shipping, '宅配便の目安', 0.3));

  // ---------------- propulsion ----------------
  const motor = need(inp.motorId), prop = need(inp.propId), bat = need(inp.batteryId);
  perVehicle.push(line('推進系', `モータ ${inp.motorId}`, inp.rotors, motor));
  if (!inp.propsIncludedWithMotors) perVehicle.push(line('推進系', `プロペラ ${inp.propId}`, inp.rotors, prop));
  perVehicle.push(line('電池', `電池 ${inp.batteryId}`, 1, bat));
  firstBuild.push(line('推進系', `モータ ${inp.motorId}`, inp.rotors, motor));
  firstBuild.push(line('推進系', `プロペラ（予備 ${S.spares.propsSets} セット${inp.propsIncludedWithMotors ? '、初回分はモータに付属' : ' ＋ 取付分'}）`, inp.rotors * (S.spares.propsSets + (inp.propsIncludedWithMotors ? 0 : 1)), prop));
  firstBuild.push(line('電池', `電池（運用 ${S.batteriesPerVehicle} 本）`, S.batteriesPerVehicle, bat));

  // ---------------- modules / mechanics ----------------
  for (const m of inp.modules) {
    const p = need(m.id);
    perVehicle.push(line('外部モジュール', m.id, m.qty, p));
    firstBuild.push(line('外部モジュール', m.id, m.qty, p));
  }
  const pla = need('PLA');
  const filamentKg = (inp.frameMassG * S.filamentFactor) / 1000;
  perVehicle.push({ ...line('機構・配線', `フレーム（PLA ${(filamentKg * 1000).toFixed(0)} g：サポート・失敗分込み）`, filamentKg, pla) });
  firstBuild.push({ ...line('機構・配線', `PLA 1 巻（1 kg）`, 1, pla) });
  for (const h of inp.hardware) {
    const p = need(h.id);
    perVehicle.push(line('機構・配線', h.id, h.qty, p));
    firstBuild.push(line('機構・配線', h.id, h.qty, p));
  }
  firstBuild.push(calc('送料・税', '海外ホビーショップの送料（1 回）', S.hobbyShipping, '目安', 0.5));
  const taxable = sum(firstBuild);
  firstBuild.push({ ...calc('送料・税', `輸入消費税 ${S.consumptionTax * 100} %`, taxable.usd * S.consumptionTax, '課税対象の合計 × 税率', 0), totalLowUsd: taxable.low * S.consumptionTax, totalHighUsd: taxable.high * S.consumptionTax });

  const tools = inp.tools.map((t) => line('道具（初回のみ）', t, 1, need(t)));
  return { input: inp, perVehicle, firstBuild, tools, totals: { perVehicle: sum(perVehicle), firstBuild: sum(firstBuild), tools: sum(tools) }, missing: [...new Set(missing)], pcb };
};

/** All price records used by a set of budgets (for the price table). */
export const usedPrices = (ids: string[]): Array<[string, PriceRecord]> => [...new Set(ids)].map((id) => [id, priceOf(id)]).filter((x): x is [string, PriceRecord] => x[1] !== null);

export const allPriceIds = (): string[] => Object.keys(PRICES);
