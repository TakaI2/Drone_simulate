/**
 * Reference prices (USD) for the budget. Checked by individual web searches on 2026-09-28
 * (no automated scraping of shop pages); items marked `estimate` could not be confirmed and use typical values.
 * Prices change often: update `usd`/`low`/`high`, the source and the date when re-checking.
 */

export type PriceBasis = 'web' | 'estimate';

export interface PriceRecord {
  /** Typical unit price [USD]. */
  usd: number;
  low: number;
  high: number;
  /** Unit the price refers to (1 pc, pack of 4, ...). */
  unit: string;
  /** Pieces per purchase unit (e.g. 4 for a 4-pack). */
  perUnit: number;
  basis: PriceBasis;
  source: string;
  url?: string;
  checked: string;
  /** JLCPCB assembly class of an SMD part (extended parts add a feeder-loading fee). */
  jlc?: 'basic' | 'extended';
  note?: string;
}

const CHECKED = '2026-09-28';
const w = (usd: number, low: number, high: number, source: string, url: string, extra: Partial<PriceRecord> = {}): PriceRecord => ({ usd, low, high, unit: '1 個', perUnit: 1, basis: 'web', source, url, checked: CHECKED, ...extra });
const e = (usd: number, low: number, high: number, source: string, extra: Partial<PriceRecord> = {}): PriceRecord => ({ usd, low, high, unit: '1 個', perUnit: 1, basis: 'estimate', source, checked: CHECKED, ...extra });

/** Prices keyed by catalog part id (electrical) or by item id (propulsion, modules, mechanics). */
export const PRICES: Record<string, PriceRecord> = {
  // ---------------- board parts ----------------
  'ESP32-S3-WROOM-1-N8': w(5.66, 4.5, 6.5, 'Digi-Key 単価', 'https://www.digikey.com/en/products/detail/espressif-systems/ESP32-S3-WROOM-1-N8/15200089', { jlc: 'extended', note: '実装にはモジュールのため Standard PCBA が必要' }),
  'ICM-42688-P': w(12, 8, 16, 'LCSC（$15.6〜、在庫なし）・Digi-Key/Mouser は在庫変動', 'https://www.lcsc.com/product-detail/C1850418.html', { jlc: 'extended', note: '供給リスク高（TrustedParts）。代替に ICM-42670-P 等' }),
  BMP390: w(3.3, 3.3, 4.6, 'Digi-Key 単価（取り寄せ）', 'https://www.digikey.com/en/products/detail/bosch-sensortec/BMP390/16164575', { jlc: 'extended', note: '在庫薄。BMP384（$3.52、在庫あり）も候補' }),
  XC6220B331MR: e(0.35, 0.2, 0.6, 'Torex LDO の一般的な小口単価', { jlc: 'extended' }),
  XC6206P182MR: e(0.05, 0.03, 0.1, '汎用 LDO の一般的な単価', { jlc: 'basic' }),
  MP2359DJ: w(0.2, 0.09, 0.3, 'LCSC/JLCPCB（互換品 $0.09〜0.18、MPS 原品 $0.22〜0.25）', 'https://jlcpcb.com/partdetail/14917-MP2359DJ_LFZ/C14259', { jlc: 'extended' }),
  'L-10u-4020': e(0.1, 0.05, 0.2, '4×4 mm パワーインダクタの一般的な単価', { jlc: 'extended' }),
  AO3400A: e(0.03, 0.02, 0.06, 'JLCPCB 基本部品の一般的な単価', { jlc: 'basic' }),
  B5819W: e(0.02, 0.01, 0.04, 'JLCPCB 基本部品の一般的な単価', { jlc: 'basic' }),
  'LED0603-R': e(0.01, 0.005, 0.02, 'JLCPCB 基本部品の一般的な単価', { jlc: 'basic' }),
  'Tact-3x4': e(0.05, 0.03, 0.1, 'SMD タクトスイッチの一般的な単価', { jlc: 'extended' }),
  'JST-SM08B-SRSS-TB': e(0.45, 0.15, 0.7, 'JST 純正は $0.5 前後、互換品 $0.1〜0.2', { jlc: 'extended' }),
  'JST-SM06B-SRSS-TB': e(0.4, 0.12, 0.6, 'JST 純正は $0.4 前後、互換品 $0.1〜0.2', { jlc: 'extended' }),
  'JST-SM08B-ESC': e(0.45, 0.15, 0.7, 'JST 純正は $0.5 前後、互換品 $0.1〜0.2', { jlc: 'extended' }),
  'JST-B2B-PH-K-S': e(0.1, 0.05, 0.2, 'JST PH スルーホールの一般的な単価', { jlc: 'extended' }),
  'PMW3901MB-TXQT': w(4.2, 3.78, 4.2, 'LCSC $3.78〜 / WPG Americas $4.20', 'https://lcsc.com/product-detail/ambient-light-sensors_pixart-pmw3901mb-txqt_C43496881.html', { jlc: 'extended' }),
  VL53L1X: w(5, 3.28, 6.63, 'LCSC $3.28〜 / Digi-Key $6.63', 'https://www.lcsc.com/product-detail/C190004.html', { jlc: 'extended' }),
  'C0603-100n': e(0.003, 0.002, 0.01, 'JLCPCB 基本部品', { jlc: 'basic' }),
  'C0603-1u': e(0.004, 0.002, 0.01, 'JLCPCB 基本部品', { jlc: 'basic' }),
  'C0805-10u': e(0.02, 0.01, 0.04, 'JLCPCB 基本部品', { jlc: 'basic' }),
  'C0805-10u-25V': e(0.04, 0.02, 0.08, '25 V 品は拡張部品のことが多い', { jlc: 'extended' }),
  'C1206-47u': e(0.1, 0.05, 0.2, '1206 47 µF の一般的な単価', { jlc: 'extended' }),
  'R0603-*': e(0.002, 0.001, 0.005, 'JLCPCB 基本部品（0603 抵抗）', { jlc: 'basic' }),
  // not assembled (pads / holes / test pads)
  MotorPad: e(0, 0, 0, '基板の穴（部品なし）'),
  BatteryPad: e(0, 0, 0, '基板の穴（部品なし）'),
  'MountHole-M2': e(0, 0, 0, '基板の穴（部品なし）'),
  'PinHeader-1x6': e(0, 0, 0, '書込み用テストパッド（部品なし）'),

  // ---------------- propulsion ----------------
  'coreless-0820': w(2.5, 1.5, 4, '8520 モータ 4 個＋65 mm プロペラのセット $9.98（Walmart/SpeedyFPV）を 1 個あたりに換算', 'https://speedyfpv.com/products/usaq-8520-coreless-brushed-motor-set-53-000rpm-with-2cw-2ccw-65mm-propellers', { note: 'プロペラ込みのセットが一般的' }),
  'prop-65': e(0.75, 0.4, 1.2, '65 mm 2 枚羽（4 枚 $3 前後）', { unit: '1 枚' }),
  'bl-1204-5000': e(13, 9, 20, '1204 5000KV（Happymodel/BETAFPV 等、1 個 $10〜15 が一般的。Banggood 表示 $37.99 は要確認）', { url: 'https://www.getfpv.com/betafpv-1204-5000kv-brushless-motor-1pc.html' }),
  'prop-76-3b': w(0.65, 0.58, 1.0, 'Gemfan Hurricane 3016 4 枚 $2.60〜3.99', 'https://blackmarketfpv.com/product/gemfan-3016-3-hurricane-3%E2%80%B3-1-5mm-shaft-propeller-4-pack/', { unit: '1 枚' }),
  'lipo-1s-600': w(7, 6, 10, 'Pyrodrone Auline $5.99 / Tower Hobbies Gens ace $7.99', 'https://pyrodrone.com/products/auline-600mah-3-7v-1s-50c-lipo-battery-xt30'),
  'lipo-2s-450': w(9.5, 7, 12, 'Banggood GNB 2S 450 mAh 80C $9.26 ほか', 'https://www.racedayquads.com/products/gaoneng-7-4v-2s-450mah-80c-lipo-whoop-micro-battery-w-xt30'),

  // ---------------- modules ----------------
  'ESC-4in1-AM32': e(30, 22, 45, '20×20 の小型 4-in-1 ESC（12〜20 A、2〜4S）の一般的な価格', { note: 'Web 検索では単体の 12 A・AM32 品がほぼ見つからず、同クラスは Bluejay（BLHeli_S 系）が主流。DShot 対応なら版 C の回路はそのまま使える' }),
  'GNSS-M10': w(21, 18.99, 22.99, 'HGLRC M100-5883（M10＋QMC5883）$20.49〜22.99 / Flywoo GM10 Nano $18.99〜', 'https://www.racedayquads.com/products/hglrc-m100-5883-gps-module-10th-gen', { note: '7.7 g（本設計の想定 5 g より重い。軽量品の選定か質量の再計算が必要）' }),
  'FlowToF-Module': w(25, 15, 50, 'PMW3901＋VL53L1X 一体モジュール（Taidacent 4M 版等）/ Pimoroni＋Pololu で約 €45', 'https://www.amazon.com/Taidacent-PMW3901-Optical-Distance-Tracking/dp/B0817Q1RG3'),
  'flow-lens': e(3, 1, 6, 'PMW3901 用遠距離レンズ（チップとセットで流通することが多い）'),

  // ---------------- mechanics / consumables ----------------
  PLA: w(20, 15, 25, 'PLA 1 kg の中央値 $19.99/kg（2026-06 時点の価格調査）', 'https://3dprintingcostcalculator.com/news/filament-price-per-gram', { unit: '1 kg' }),
  'screws-m2': e(5, 3, 8, 'M2 ねじ・ナット・ナイロンスペーサのセット', { unit: '1 セット' }),
  'battery-strap': e(1, 0.5, 2, '電池ストラップ・滑り止め', { unit: '1 本' }),
  'wire-misc': e(4, 2, 6, 'シリコン線（AWG 20/28）・熱収縮チューブ・はんだ', { unit: '1 式' }),
  'xt30-pigtail': e(1, 0.5, 2, 'XT30 ピッグテール', { unit: '1 本' }),
  'jst-sh-cable': e(2, 1, 4, 'JST-SH 両端ケーブル（ESC・GNSS・子基板用）', { unit: '1 式' }),

  // ---------------- tools (one-off) ----------------
  'charger-1s': e(20, 12, 35, '1S LiPo 充電器（複数ポート）'),
  'charger-2s': e(35, 25, 60, '2S 対応バランス充電器'),
  'usb-uart': e(5, 3, 10, 'USB-シリアル変換（ESP32 書込み用）'),
  'pogo-jig': e(10, 5, 20, 'ポゴピン書込み治具'),
  'lipo-bag': e(8, 5, 15, 'LiPo 保管用の耐火バッグ'),
};

/** JLCPCB order model (2-layer, ≤ 100 × 100 mm). Fees from JLCPCB help pages / TechOverflow overview. */
export const PCB_ORDER = {
  source: 'JLCPCB ヘルプ「PCB Assembly Cost」、TechOverflow「JLCPCB PCBA assembly price overview」',
  url: 'https://techoverflow.net/2024/04/09/jlcpcb-pcba-assembly-price-overview/',
  checked: CHECKED,
  boardsOrdered: 5,
  boardsAssembled: 2,
  /** 2-layer prototype (5 pcs, ≤ 100 mm) [USD]. */
  fabrication: 2,
  /** Standard PCBA is required for modules such as the ESP32 (economic + $17). */
  setupStandard: 25,
  setupEconomic: 8,
  stencil: 1.5,
  engineering: 3.5,
  /** Per extended part type (feeder loading) [USD]; recently reduced from $3 to $1.5. */
  extendedFee: 1.5,
  perJoint: 0.0017,
  /** International shipping to Japan (courier) [USD]. */
  shipping: 20,
} as const;

/** General purchasing assumptions. */
export const BUDGET_SETTINGS = {
  /** USD/JPY on 2026-09-28 (Trading Economics 157.7, Yahoo 157.2). */
  usdJpy: 157,
  /** Import consumption tax (Japan) on goods. */
  consumptionTax: 0.1,
  /** Shipping for hobby parts ordered from overseas shops (one order) [USD]. */
  hobbyShipping: 15,
  /** Spare quantities for the first build. */
  spares: { propsSets: 2, batteries: 2 },
  /** Batteries per vehicle in normal use. */
  batteriesPerVehicle: 3,
  /** Filament used per frame including supports and a failed print [g per frame gram]. */
  filamentFactor: 2,
} as const;

/** Price lookup: exact id, then the 0603 resistor wildcard. */
export const priceOf = (id: string): PriceRecord | null => PRICES[id] ?? (id.startsWith('R0603-') ? PRICES['R0603-*'] : null);
