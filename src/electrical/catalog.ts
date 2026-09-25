/**
 * Electronic part catalog (Class A flight controller).
 * Specs are taken from the manufacturers' public datasheets as commonly published;
 * anything marked `verify` must be re-checked against the latest datasheet before ordering.
 */

export type PartCategory =
  | 'mcu' | 'imu' | 'baro' | 'ldo' | 'mosfet' | 'diode' | 'resistor' | 'capacitor' | 'led'
  | 'connector' | 'switch' | 'module' | 'pad' | 'mechanical';

export interface Alternative {
  mpn: string;
  manufacturer: string;
  note: string;
}

export interface PartRecord {
  id: string;
  category: PartCategory;
  name: string;
  mpn: string;
  manufacturer: string;
  /** Package id understood by parts3d / pcb. */
  package: string;
  specs: Record<string, string | number>;
  massG: number;
  /** Body size L x W x H [mm]. */
  dims: [number, number, number];
  alternatives: Alternative[];
  /** Items that must be checked against the datasheet before fabrication. */
  verify?: string;
  /** Radio certification (Japan) where relevant. */
  giteki?: string;
}

const chipR = (value: string, mpnCode: string): PartRecord => ({
  id: `R0603-${value}`,
  category: 'resistor',
  name: `チップ抵抗 ${value} 1% 0603(1608)`,
  mpn: `RC0603FR-07${mpnCode}L`,
  manufacturer: 'Yageo',
  package: 'R0603',
  specs: { 抵抗値: value, 許容差: '±1%', 定格電力: '0.1 W' },
  massG: 0.002,
  dims: [1.6, 0.8, 0.45],
  alternatives: [
    { mpn: `ERJ-3EKF${mpnCode.toUpperCase()}V 相当`, manufacturer: 'Panasonic', note: '同一サイズ・同一値の汎用品' },
    { mpn: `RK73H1JTTD 相当`, manufacturer: 'KOA', note: '同一サイズ・同一値の汎用品' },
  ],
});

const chipC = (id: string, value: string, mpn: string, pkg: 'C0603' | 'C0805' | 'C1206', voltage: string, dielectric: string, massG: number, dims: [number, number, number]): PartRecord => ({
  id,
  category: 'capacitor',
  name: `積層セラミックコンデンサ ${value} ${voltage} ${dielectric} ${pkg.slice(1)}`,
  mpn,
  manufacturer: 'Murata',
  package: pkg,
  specs: { 容量: value, 定格電圧: voltage, 温度特性: dielectric },
  massG,
  dims,
  alternatives: [
    { mpn: 'CL シリーズ同等品', manufacturer: 'Samsung Electro-Mechanics', note: '同容量・同サイズ・同耐圧' },
    { mpn: 'C シリーズ同等品', manufacturer: 'TDK', note: '同容量・同サイズ・同耐圧' },
  ],
});

export const PARTS: PartRecord[] = [
  {
    id: 'ESP32-S3-WROOM-1-N8',
    category: 'mcu',
    name: 'Wi-Fi/BLE マイコンモジュール ESP32-S3（8MB Flash, PSRAM なし）',
    mpn: 'ESP32-S3-WROOM-1-N8',
    manufacturer: 'Espressif Systems',
    package: 'ESP32-S3-WROOM-1',
    specs: { CPU: 'Xtensa LX7 デュアル 240 MHz', 電源電圧: '3.0–3.6 V', 'Wi-Fi 送信時ピーク電流': '約 340 mA', GPIO: 36, ADC: '12 bit SAR' },
    massG: 3.0,
    dims: [18, 25.5, 3.1],
    alternatives: [
      { mpn: 'ESP32-S3-MINI-1-N8', manufacturer: 'Espressif Systems', note: '小型（15.4×20.5 mm）。フットプリント変更が必要' },
      { mpn: 'M5Stamp S3', manufacturer: 'M5Stack', note: 'USB・LDO 内蔵の小型モジュール。はんだ付けで搭載' },
      { mpn: 'STM32F405 + 外付け無線', manufacturer: 'STMicroelectronics', note: 'Betaflight/ArduPilot 系 FC と同系統。回路規模が増える' },
    ],
    giteki: '技適取得済みモジュール（使用前に型番ごとの認証番号を確認）',
    verify: 'モジュール寸法とパッド位置（1.27 mm ピッチ）、アンテナ禁止領域',
  },
  {
    id: 'ICM-42688-P',
    category: 'imu',
    name: '6軸 IMU（ジャイロ＋加速度）',
    mpn: 'ICM-42688-P',
    manufacturer: 'TDK InvenSense',
    package: 'LGA-14-2.5x3',
    specs: { 電源電圧: '1.71–3.6 V', インタフェース: 'SPI 24 MHz / I²C', ジャイロノイズ: '2.8 mdps/√Hz', 消費電流: '0.88 mA（6軸 LN）' },
    massG: 0.02,
    dims: [2.5, 3.0, 0.91],
    alternatives: [
      { mpn: 'BMI270', manufacturer: 'Bosch Sensortec', note: '同寸法 LGA-14。ピン配置は異なるため回路・基板の変更が必要' },
      { mpn: 'LSM6DSO', manufacturer: 'STMicroelectronics', note: '同寸法 LGA-14。ピン配置は異なる' },
    ],
    verify: 'ピン番号と RESV ピンの処理、推奨デカップリング容量',
  },
  {
    id: 'BMP390',
    category: 'baro',
    name: '気圧センサ',
    mpn: 'BMP390',
    manufacturer: 'Bosch Sensortec',
    package: 'LGA-10-2x2',
    specs: { 電源電圧: '1.65–3.6 V', インタフェース: 'I²C / SPI', 相対精度: '±0.03 hPa（約 ±0.25 m）' },
    massG: 0.01,
    dims: [2.0, 2.0, 0.75],
    alternatives: [
      { mpn: 'DPS310', manufacturer: 'Infineon', note: 'LGA-8 2.0×2.5 mm。フットプリント変更が必要' },
      { mpn: 'LPS22HB', manufacturer: 'STMicroelectronics', note: 'HLGA-10 2×2 mm' },
    ],
    verify: 'ピン配置と通気穴の向き',
  },
  {
    id: 'XC6220B331MR',
    category: 'ldo',
    name: '3.3 V LDO レギュレータ 1 A',
    mpn: 'XC6220B331MR-G',
    manufacturer: 'Torex',
    package: 'SOT-23-5',
    specs: { 出力: '3.3 V', 最大出力電流: 1.0, 'ドロップアウト（参考）': '約 0.1 V @ 200 mA / 約 0.35 V @ 600 mA', 最大入力: '6.0 V', 'θja（参考）': 250 },
    massG: 0.015,
    dims: [2.9, 1.6, 1.1],
    alternatives: [
      { mpn: 'AP2112K-3.3TRG1', manufacturer: 'Diodes Inc.', note: '600 mA、同一ピン配置の汎用品（CE/EN 位置要確認）' },
      { mpn: 'ME6211C33M5G', manufacturer: 'Microne', note: '500 mA、低価格。Wi-Fi ピーク時の余裕は小さい' },
    ],
    verify: 'SOT-25 のピン配置（VIN/VSS/CE/NC/VOUT）',
  },
  {
    id: 'AO3400A',
    category: 'mosfet',
    name: 'N-ch MOSFET 30 V 5.7 A（ロジックレベル）',
    mpn: 'AO3400A',
    manufacturer: 'Alpha & Omega Semiconductor',
    package: 'SOT-23',
    specs: { Vds: 30, 'Id(連続)': 5.7, 'Rds(on)@4.5V': 0.028, 'Rds(on)@2.5V': 0.048, 'Vgs(th) max': 1.45, Qg: '約 6 nC', 'θja（参考）': 125 },
    massG: 0.008,
    dims: [2.9, 1.3, 1.0],
    alternatives: [
      { mpn: 'SI2302CDS', manufacturer: 'Vishay', note: '20 V。Rds(on) がやや大きい（発熱計算を再確認）' },
      { mpn: 'DMG3420U', manufacturer: 'Diodes Inc.', note: '20 V ロジックレベル SOT-23' },
    ],
  },
  {
    id: 'B5819W',
    category: 'diode',
    name: 'ショットキーダイオード 40 V 1 A（モータ還流用）',
    mpn: 'B5819W',
    manufacturer: '各社（汎用品）',
    package: 'SOD-123',
    specs: { VRRM: 40, 'IF(AV)': 1.0, IFSM: 25, VF: '約 0.45 V @ 1 A' },
    massG: 0.01,
    dims: [2.7, 1.6, 1.1],
    alternatives: [
      { mpn: 'SS14', manufacturer: '各社', note: 'SMA パッケージ（大きい）' },
      { mpn: 'MBR0540', manufacturer: 'onsemi', note: '0.5 A。ホバリング時の平均電流は満たすが余裕が小さい' },
    ],
  },
  chipR('47Ω', '47R'),
  chipR('1kΩ', '1K'),
  chipR('4.7kΩ', '4K7'),
  chipR('10kΩ', '10K'),
  chipR('100kΩ', '100K'),
  chipC('C0603-100n', '100 nF', 'GRM188R71C104KA01D', 'C0603', '16 V', 'X7R', 0.005, [1.6, 0.8, 0.8]),
  chipC('C0603-1u', '1 µF', 'GRM188R61A105KA61D', 'C0603', '10 V', 'X5R', 0.005, [1.6, 0.8, 0.8]),
  chipC('C0805-10u', '10 µF', 'GRM21BR61A106KE19L', 'C0805', '10 V', 'X5R', 0.012, [2.0, 1.25, 1.25]),
  chipC('C1206-47u', '47 µF', 'GRM31CR60J476ME19L', 'C1206', '6.3 V', 'X5R', 0.03, [3.2, 1.6, 1.6]),
  {
    id: 'LED0603-R',
    category: 'led',
    name: 'チップ LED 赤 0603(1608)',
    mpn: 'APT1608EC',
    manufacturer: 'Kingbright',
    package: 'LED0603',
    specs: { VF: '約 2.0 V', IF: '20 mA max' },
    massG: 0.003,
    dims: [1.6, 0.8, 0.75],
    alternatives: [{ mpn: 'SML-D12U1W', manufacturer: 'ROHM', note: '0603 赤' }],
  },
  {
    id: 'JST-B2B-PH-K-S',
    category: 'connector',
    name: '電池コネクタ JST PH 2 ピン（トップ、THT）',
    mpn: 'B2B-PH-K-S(LF)(SN)',
    manufacturer: 'J.S.T. Mfg.',
    package: 'JST-PH-2-THT',
    specs: { ピッチ: '2.0 mm', 定格電流: '2 A（コンタクト定格。短時間の大電流は要注意）' },
    massG: 0.3,
    dims: [6.0, 4.5, 6.0],
    alternatives: [
      { mpn: 'S2B-PH-SM4-TB', manufacturer: 'J.S.T. Mfg.', note: 'SMD サイド型' },
      { mpn: 'BT2.0 / PH2.0 互換品', manufacturer: '各社', note: 'マイクロ機向けの大電流品（公式定格なし）' },
    ],
    verify: '最大 8〜10 A 流れるため、PH の定格 2 A を超える。実機では BT2.0 等の大電流コネクタ、または電池リード直付けを推奨',
  },
  {
    id: 'JST-SM08B-SRSS-TB',
    category: 'connector',
    name: 'フロー＋ToF モジュール用 JST SH 8 ピン（SMD）',
    mpn: 'SM08B-SRSS-TB(LF)(SN)',
    manufacturer: 'J.S.T. Mfg.',
    package: 'JST-SH-8-SMD',
    specs: { ピッチ: '1.0 mm', 定格電流: '1 A' },
    massG: 0.1,
    dims: [10.0, 4.25, 2.9],
    alternatives: [{ mpn: 'SH 互換 1.0 mm 8P', manufacturer: '各社', note: '互換品' }],
  },
  {
    id: 'PinHeader-1x6',
    category: 'connector',
    name: '書込み用ピンヘッダ 1×6 2.54 mm（飛行時は未実装可）',
    mpn: 'PH-1x6 2.54mm',
    manufacturer: '各社（汎用品）',
    package: 'PinHeader-1x6-2.54',
    specs: { ピッチ: '2.54 mm' },
    massG: 0.4,
    dims: [15.2, 2.5, 8.5],
    alternatives: [{ mpn: 'ポゴピン治具', manufacturer: '—', note: 'ヘッダを実装せずパッドに当てて書込み' }],
  },
  {
    id: 'Tact-3x4',
    category: 'switch',
    name: 'タクトスイッチ 3×4 mm（SMD）',
    mpn: 'TS-1187A-B-A-B',
    manufacturer: 'XKB Connection',
    package: 'Tact-3x4-SMD',
    specs: { 定格: '50 mA 12 V' },
    massG: 0.05,
    dims: [4.0, 3.0, 2.5],
    alternatives: [{ mpn: 'SKRPACE010', manufacturer: 'Alps Alpine', note: '4.2×3.2 mm、フットプリント変更が必要' }],
  },
  {
    id: 'MotorPad',
    category: 'pad',
    name: 'モータ配線用スルーホールパッド（2 極）',
    mpn: '—',
    manufacturer: '—',
    package: 'MotorPad-2',
    specs: { 穴径: '1.0 mm' },
    massG: 0,
    dims: [4.0, 2.0, 0],
    alternatives: [],
  },
  {
    id: 'BatteryPad',
    category: 'pad',
    name: '電池リード直付けパッド（2 極、20 AWG 用）',
    mpn: '—',
    manufacturer: '—',
    package: 'BatteryPad-2',
    specs: { 穴径: '1.3 mm', 想定電流: '10 A（20 AWG リード）' },
    massG: 0,
    dims: [6.0, 3.0, 0],
    alternatives: [{ mpn: 'B2B-PH-K-S', manufacturer: 'J.S.T. Mfg.', note: '定格 2 A のため非推奨（ホバリングでも約 2.5 A）' }],
  },
  {
    id: 'MountHole-M2',
    category: 'mechanical',
    name: 'M2 取付穴',
    mpn: '—',
    manufacturer: '—',
    package: 'MountHole-M2',
    specs: { 穴径: '2.2 mm' },
    massG: 0,
    dims: [4.0, 4.0, 0],
    alternatives: [],
  },
  {
    id: 'FlowToF-Module',
    category: 'module',
    name: 'オプティカルフロー（PMW3901）＋ToF（VL53L1X）モジュール',
    mpn: 'PMW3901 + VL53L1X ブレイクアウト',
    manufacturer: '各社（Pimoroni、CJMCU 等）',
    package: 'external',
    specs: { 電源: '3.3 V', インタフェース: 'SPI（フロー）＋I²C（ToF）', ToF測距: '〜4 m' },
    massG: 2.0,
    dims: [20, 15, 4],
    alternatives: [
      { mpn: 'Flow deck v2', manufacturer: 'Bitcraze', note: '同構成。Crazyflie 専用コネクタ' },
      { mpn: 'MTF-01 / 3901-L0X', manufacturer: 'Micoair / Matek', note: 'UART 出力型。回路の変更が必要' },
    ],
  },
];

export const findPart = (id: string): PartRecord => {
  const p = PARTS.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown part ${id}`);
  return p;
};

export interface VendorLink {
  vendor: string;
  url: string;
}

/** Search links (no scraping; prices/stock must be checked on the site). */
export const vendorLinks = (mpn: string): VendorLink[] => {
  if (mpn === '—') return [];
  const q = encodeURIComponent(mpn.replace(/ 相当$/, '').split(' ')[0]);
  return [
    { vendor: 'Digi-Key', url: `https://www.digikey.jp/ja/products/result?keywords=${q}` },
    { vendor: 'Mouser', url: `https://www.mouser.jp/c/?q=${q}` },
    { vendor: 'LCSC', url: `https://www.lcsc.com/search?q=${q}` },
    { vendor: '秋月電子', url: `https://akizukidenshi.com/catalog/goods/search.aspx?keyword=${q}` },
    { vendor: 'スイッチサイエンス', url: `https://www.switch-science.com/search?q=${q}` },
  ];
};
