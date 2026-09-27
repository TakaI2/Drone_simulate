# 設計書

前提: `.tmp/requirements.md`

## 1. 技術スタック

| 領域 | 採用 | ライセンス | 理由 |
|---|---|---|---|
| 言語 | TypeScript（strict） | Apache-2.0 | 型安全、ブラウザと Node の両対応 |
| 3D 描画 | three.js | MIT | plan.txt の指定 |
| ブーリアン演算 | three-bvh-csg | MIT | フレームの穴あけ・結合（STL を多様体にする） |
| ビルド | Vite | MIT | 高速な開発サーバ |
| テスト | Vitest | MIT | Vite と設定共有 |
| スクリーンショット | playwright-core ＋ 既存 Chrome | Apache-2.0 | ブラウザ本体をダウンロードせずに撮影 |
| スクリプト実行 | tsx | MIT | Node で TS を直接実行 |

UI フレームワークは使わない（素の DOM）。依存を最小にし、ライセンス確認の負担を減らすため。

## 2. 座標系と単位

- ワールド座標: ENU（x 東、y 北、z 上）。three.js も `Object3D.DEFAULT_UP = (0,0,1)` で z 上に揃える。
- 機体座標: FLU（x 前、y 左、z 上）。姿勢は機体→ワールドの単位クォータニオン。
- 単位: 物理・制御・サイジングは SI（m, kg, s, N, V, A）。基板と機体形状は mm。
- ロータ回転方向 `spin`: 上から見て反時計回り（CCW）を +1。機体への反トルクは `-spin * kQ * ω²`（z 軸まわり）。

## 3. ディレクトリ構成

```
src/
  core/         ベクトル・クォータニオン・行列、乱数、共通型、プリセット
  sim/          環境、風、動力学、モータ、電池、センサ、推定器、衝突、シミュレータ本体、シナリオ
  control/      PID、位置・速度・姿勢・角速度制御、制御配分（ミキサ）、飛行モード
  planning/     ボクセル格子、3D A*、経路短縮、経路追従
  sizing/       推進系サイジング（運動量理論、モータモデル）
  electrical/   部品カタログ、回路生成、電気計算、回路図 SVG、BOM
  parts3d/      パッケージ規格定義、パラメトリック3Dモデル
  pcb/          フットプリント、配置、配線、GND ベタ、ビア、DRC、Gerber・ドリル出力、SVG
  airframe/     フレーム生成、質量特性、部品配置、STL 出力
  integration/  設計値→シミュレーション用パラメータの導出
  ui/           画面（シミュレーション、電気、基板、機体、統合）
scripts/        stage1〜5 の実行、レポート生成、スクリーンショット
tests/          Vitest
reports/        HTML レポートと画像（生成物）
out/            Gerber、STL、3D アーカイブなど（生成物）
```

依存方向: `ui → (integration, airframe, pcb, electrical, sizing, sim, control, planning) → core`。コアは DOM に依存しない。

## 4. 共通データモデル（`src/core/types.ts`）

```ts
interface MotorSpec { kv; resistance; noLoadCurrent; timeConstant; maxCurrent; mass }
interface PropSpec  { diameter; ct; cp; mass }            // 推力係数 CT、パワー係数 CP
interface RotorSpec { position: Vec3; spin: 1 | -1; motor; prop }
interface BatterySpec { cells; capacityAh; internalResistance; mass; cellVoltageMin; cellVoltageMax }
interface AirframeMassProps { mass; cg: Vec3; inertia: Mat3 }
interface DroneParams {
  name; mass; inertia: Mat3; rotors: RotorSpec[]; battery;
  dragArea; dragCoeff; rotorDragCoeff; collisionRadius; sensors; controller;
}
```

`kT = CT·ρ·D⁴/(4π²)`、`kQ = CP·ρ·D⁵/(8π³)`（ω は rad/s）。

## 5. 物理モデル（段階1）

### 5.1 状態

位置 p、速度 v（ワールド）、姿勢 q、角速度 ω（機体）、各ロータ回転数 Ωᵢ、電池の充電状態 SoC。

### 5.2 モータ（電気的定常解＋一次遅れ）

PWM デューティ u と電池端子電圧 V から実効電圧 Ve = u·V。
定常回転数は `Ve = Ω/Kv + R(I0 + kQ·Ω²·Kv)`（Kv は rad/s/V）の正の解。
`dΩ/dt = (Ω_ss − Ω)/τ`。電池電流は `Σ u·I_motor`。
この形にすると、電池電圧降下がそのまま最大推力の低下として現れる。

### 5.3 電池

`V = cells·OCV(SoC) − R_int·I`。OCV は LiPo の代表的な放電曲線を区分線形で表す。

### 5.4 力とモーメント

- 推力 `Tᵢ = kT·Ωᵢ²·g_e(h)`。地面効果は `g_e = 1/(1 − (R/4h)²)`（Cheeseman–Bennett、h ≥ 0.6R で打ち切り）。
- 抗力 `F_d = −½ρ·CdA·|v_r|·v_r − c_rd·(ΣΩ/ΣΩ_hover)·v_r,水平`（v_r は対気速度）。
- モーメント `M = Σ rᵢ × (0,0,Tᵢ) + Σ(−spinᵢ·kQ·Ωᵢ²)ẑ − ω × Jω`。
- 積分: 剛体は RK4（1 kHz）、ロータは一次遅れの厳密離散化。

### 5.5 風

平均風ベクトル＋各軸独立の Gauss–Markov 過程（相関時間 τ_g、標準偏差 σ_g）。乱数はシード固定で再現可能にする。

### 5.6 衝突

- 地面: バネ・ダンパの接地反力と摩擦。着地速度 > 2 m/s、または接地時傾き > 60° を墜落と判定する。
- 障害物: 機体を半径 r の球とみなし、直方体（AABB）と円柱に対して判定する。接触したら墜落として記録する。

## 6. センサと推定

| センサ | 周期 | モデル |
|---|---|---|
| ジャイロ | 1 kHz | 白色雑音＋バイアスのランダムウォーク |
| 加速度計 | 1 kHz | 白色雑音＋固定バイアス |
| 高度（ToF / 気圧） | 50 Hz | 白色雑音 |
| 水平位置（フロー積分 / GNSS） | 50 Hz | 白色雑音＋ドリフト |

推定器:
- 姿勢は Mahony 相補フィルタ（ジャイロ積分＋加速度による傾き補正）。
- 位置・速度は軸ごとの線形カルマンフィルタ（加速度を入力、位置を観測）。
- `estimator: 'truth' | 'filter'` で切り替える。

## 7. 制御（PX4 の構成を参考に独自実装）

1. 位置 P: `v_sp = Kp·(p_sp − p̂) + v_ff`（水平・垂直で速度上限）
2. 速度 PID: `a_sp = Kp·e_v + Ki∫e_v + Kd·ė_v + a_ff`
3. 推力ベクトル: `F = m(a_sp + g·ẑ)`。傾き上限で制限し、目標機体 z 軸とヨー角から目標姿勢 q_sp を作る。集合推力は `F·b_z`。
4. 姿勢 P: `q_e = q̂⁻¹ ⊗ q_sp`、`ω_sp = 2·Kp·sign(q_e.w)·q_e.xyz`（ヨーは重み小）
5. 角速度 PID: `τ = J(Kp·e_ω + Ki∫ + Kd·ė_ω) + ω×Jω`
6. 制御配分: `[T, τx, τy, τz]ᵀ = B·f`、`B` の列 i は `(1, yᵢ, −xᵢ, −spinᵢ·kQ/kT)`。`f = B⁺·w`。`det(BBᵀ)` が小さい場合は「制御不能な配置」として警告する。
7. 飽和処理: ヨートルクを縮小 → 集合推力をシフト → 最終クリップの順に行う。
8. 推力→PWM: `Ωᵢ = √(fᵢ/kT)` から必要な Ve を求め、`u = Ve / V̂bat`（電池電圧補償）。

飛行モード: `IDLE → TAKEOFF → MISSION → HOVER → LAND → LANDED`。セル電圧が閾値未満になると `LAND` に強制遷移する。手動モードは「高度維持＋角度モード」。

## 8. 経路計画

1. 障害物を（機体半径＋安全余裕）で膨張させ、解像度 0.1 m のボクセル格子に占有を記録する。最低飛行高度より下も占有扱い（離着陸点の直上は除く）。
2. 26 近傍 A*（ユークリッド距離ヒューリスティック）。
3. 視線判定による経路短縮（string pulling）。
4. 追従: 経路上の目標点を巡航速度で進める。追従誤差が大きいときは進行を遅らせる。位置目標と速度フィードフォワードを制御に渡す。

## 9. 推進系サイジング（段階2）

- ホバリング推力 `T_h = m·g/N`、ホバリング回転数 `Ω_h = √(T_h/kT)`。
- 最大推力はモータモデルで u=1、公称電圧（負荷時）として求める。
- 推力重量比 `TWR = N·T_max/(m·g)`、ホバリングスロットル `u_h`。
- 飛行時間 `t = 0.8·C / I_hover`（使用可能容量80 %）。
- 運動量理論による理想パワー `P_i = T^{3/2}/√(2ρA)` と性能指数 FoM を併記する。
- 探索: カタログのモータ×プロペラ×電池の全組合せで全備重量を反復計算する。制約（TWR、100 g 未満）を満たす中から飛行時間最大の組を推奨する。

## 10. 電気設計（段階2）

回路はブロック単位で生成する。

| ブロック | 内容 |
|---|---|
| 電源 | JST-PH 電池コネクタ、スライドスイッチ、バルクコンデンサ、LDO 3.3 V＋入出力コンデンサ |
| マイコン | ESP32-S3-WROOM-1（技適取得済み）、EN の RC、BOOT/EN ボタン、書込み用 UART ヘッダ |
| センサ | IMU ICM-42688-P（SPI）、気圧 BMP390（I²C）、フロー＋ToF モジュール用 JST-SH コネクタ |
| モータ駆動 ×N | N-MOSFET AO3400A、ゲート抵抗、プルダウン、還流ショットキー、モータパッド |
| 監視 | 電池分圧（100k/100k＋100 nF）、状態 LED |

データ構造: `Component { ref, partId, pins: Pin[] }`、`Net { name, pins: PinRef[], class: 'signal'|'power'|'motor'|'gnd' }`。
計算: MOSFET の Rds(on)（Vgs=3.3 V）での損失と温度上昇、ゲート抵抗、LDO 損失、分圧比と ADC 範囲、デカップリング容量。
出力: 回路図 SVG（ブロックごとに配置）、ネットリスト JSON と KiCad 互換ネットリスト、BOM CSV。

## 11. 部品カタログと3Dモデル（段階3）

- `PartRecord { id, mpn, manufacturer, category, package, specs, dimensions, massG, alternatives[], vendors[] }`。
- 購入先は検索 URL を生成する（秋月電子、スイッチサイエンス、LCSC、Digi-Key、Mouser）。
- パッケージ生成器: `chip(EIA)`, `sot23(3/5/6)`, `sod123`, `soic`, `lga`, `qfn`, `module`, `pinHeader`, `jstPH`, `jstSH`, `tactSwitch`, `slideSwitch`, `led`, `axial`, `radial`, `to92`, `to220`, `coreless motor`, `propeller`, `battery`。
- アーカイブ: `out/parts3d/<package>.stl` と `catalog.json`。

## 12. 基板（段階3）

1. フットプリント: パッケージ定義からパッド形状を生成する（3Dモデルと同一の寸法ソース）。
2. 配置: 規則ベース（IMU は基板中心＝機体重心付近、モータ駆動は各コーナーのモータパッド付近、電源は電池コネクタ側、デカップリングは対応 IC ピンの近傍）。その後、重なりを解消する。
3. 配線: 0.1 mm グリッド、2層。ネットごとに最小全域木で接続対を作り、A* で配線する。層変更にはビアを使い、コストを加算する。他ネットの銅箔は（線幅/2＋クリアランス）で膨張させて通行不可にする。失敗したら順序を入れ替えて再試行（rip-up and reroute）。
4. GND: GND パッドの近傍にビアを置き、両面に GND ベタを流す。孤島は除去し、ベタの重なる領域に格子状のスティッチングビアを置く。
5. 発熱対策: 発熱ピン（MOSFET ドレイン）の周囲に同ネットの放熱銅箔を両面に置き、サーマルビアで接続する。
6. DRC: 格子ではなく厳密な幾何（線分・円・矩形の距離）でクリアランス、線幅、穴径、基板端距離を検査する。
7. 出力: Gerber RS-274X（F/B.Cu、F/B.Mask、F.SilkS、F.Paste、Edge.Cuts）、Excellon ドリル、ZIP。

## 13. 機体設計（段階4）

- 腕長: 隣接モータ間距離 `2L·sin(π/N) ≥ D + gap` と、プロペラ円と中央プレート角の距離 ≥ D/2 + gap の両方を満たす最小値。
- フレーム: 中央プレート（基板取付穴）、腕、モータクランプ、脚、電池トレイ。three-bvh-csg で結合・穴あけする。
- 質量特性: 部品を直方体・円柱で近似し、平行軸の定理で合成する。フレームはメッシュ体積（発散定理）×密度×充填率で計算する。
- バランス: 電池位置を動かして重心の水平位置を推力中心に一致させる。
- 検証: 辺共有数による watertight 判定、プロペラ間隙間。

## 14. 統合（段階5）

`deriveDroneParams(design)`: 機体・基板・部品・電池の質量特性を合成し、モータとプロペラの仕様からロータの推力係数を作る。制御ゲインは慣性に比例させてスケーリングする（角速度ゲインは J 比、位置ゲインは据え置き）。

## 15. UI

タブ構成: 「シミュレーション」「推進・電気」「部品・基板」「機体」「統合」。

- シミュレーション: 環境・コース・機体プリセット・風の設定、実行／一時停止／リセット、自律／手動切替、軌跡、テレメトリ。
- URL パラメータ（`?tab=sim&scenario=G1-3&autorun=1`）で自動実行できる。完了時に `document.body.dataset.ready = "1"` を立て、Playwright が撮影する。

## 16. レポート

`scripts/stageN.ts` がゴール判定を JSON に出力する。`scripts/report.ts` が HTML にまとめる。内容は、合否表、グラフ（SVG）、スクリーンショット、試行履歴、懸念点。

## 17. 実装時の設計変更（試行の結果）

| 項目 | 当初設計 | 変更後 | 理由 |
|---|---|---|---|
| 電池接続 | JST-PH コネクタ | 20 AWG リード直付けパッド | PH の定格 2 A に対し最大 8 A 超（電気計算で検出） |
| 書込み端子 | 2.54 mm ピンヘッダ | 1.27 mm テストパッド（ポゴピン） | 36〜40 mm 基板に収まらない・重量 |
| 部品選定 | 飛行時間最大 | 汎用品優先 → 飛行時間最大 | plan.txt の「替えがきく部品」方針 |
| 細ピッチ部品 | 通常配線 | ファンアウト（列の中央から）＋直下の配線・ビア禁止 | 外側ピンの配線が中央ピンを囲い込み未配線 |
| 無線モジュール | 通常部品 | 直下の上面を配線禁止、アンテナを基板外へ張り出し | 露出パッドとの短絡・アンテナ性能 |
| GND | スタブ＋ベタ | GND 網を先に配線（tree-first）→ ベタ → 孤島除去 → 補修パス | 下面信号でベタが分断され EPAD 等が孤立 |
| 配線の余裕 | 0.75 セル | 1.5 セル | 経路短縮後の任意角線分で 0.025 mm のクリアランス不足 |
| 配置間隔 | 0.15 mm | 0.3 mm | GND ビアを置く余地がないパッドが発生 |
| フレームのブーリアン | three-bvh-csg | manifold-3d（Apache-2.0） | STL の閉じた多様体性を保証するため |
| 電池固定位置 | 固定 | 重心合わせで解いた位置にスロットを配置（反復） | 重心と推力中心の一致（ずれ 0.001 mm） |
| 評価関数 | ホバリング区間の誤差 | ＋「ホバリング到達」条件 | 上昇できないケースを誤って合格と判定していた |

## 18. 改良版 B の設計

- 版の切替: `generateCircuit({ rotorCount, gnssConnector })`、子基板は `generateFlowBoard()`。成果物は `out/variantB/`、レポートは `reports/variantB.html`。版 A の出力（`out/stage*`）は変えない。
- 子基板回路: PMW3901MB（VDD 1.8 V / VDDIO 3.3 V、SPI）、VL53L1X（2.8〜3.3 V、I²C、XSHUT プルアップ）、1.8 V LDO（SOT-23）、デカップリング、JST-SH 8（メイン J2 と同配列）、M2 穴 2 個（機首の穴位置に一致）、レンズ（機構部品）。
- 子基板の基板化: 既存パイプラインを長方形基板と任意の取付穴位置に拡張して流用する。部品面を下に向けて機首下面へ固定（片面実装のまま）。
- GNSS コネクタ: JST-SH 6（SM06B-SRSS-TB）、UART1 TX=IO47 / RX=IO48、I²C はセンサと共用（磁気センサ用）。
- GNSS 誤差: `SensorSpec` に Gauss–Markov の位置・高度バイアス（σ, τ）を追加。屋外環境（±40 m）と 20 m 四方の経由点コースを追加。
- フレーム: 機首付け根にケーブル通し穴（3×8 mm）。機首下面の質量・寸法は子基板の実値を使う。
