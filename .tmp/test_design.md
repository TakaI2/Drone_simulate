# テスト設計書

前提: `.tmp/design.md`。単体テストは Vitest、段階ゴールは `scripts/stageN.ts` で判定する。

## 1. 単体テスト

| ID | 対象 | 内容 | 期待値 |
|---|---|---|---|
| T-M1 | core/math | クォータニオン回転・正規化・合成 | ベクトル回転が回転行列と一致（1e-9） |
| T-M2 | core/math | 3×3 逆行列・擬似逆行列 | A·A⁻¹ = I |
| T-P1 | sim/dynamics | モータ停止で自由落下1秒 | z 変位 = −½g（誤差1 %、抗力なし） |
| T-P2 | sim/dynamics | ホバリング推力を一定入力 | 加速度 ≈ 0 |
| T-P3 | sim/dynamics | 対角モータ差でヨー | 反トルクの向きが spin 規約どおり |
| T-P4 | sim/motor | 定常回転数の解 | 電圧方程式の残差 < 1e-6 |
| T-P5 | sim/battery | 電流を流すと電圧降下 | V = OCV − R·I |
| T-P6 | sim/collision | 球と AABB・円柱 | 既知ケースで交差判定が正しい |
| T-C1 | control/allocation | クアッド X・ヘキサの配分 | B·B⁺·w = w |
| T-C2 | control/allocation | 同一直線上ロータ | 制御不能と判定 |
| T-C3 | control/allocation | 飽和処理 | 出力が全て [f_min, f_max] 内 |
| T-C4 | control/pid | 積分飽和防止 | 積分項が上限内 |
| T-N1 | planning/astar | 壁を迂回 | 経路が占有セルを通らない |
| T-N2 | planning/smooth | 短縮後の経路 | 全区間で視線判定が通る |
| T-S1 | sizing | 手計算例と一致 | 推力・電流・飛行時間が1 %以内 |
| T-E1 | electrical | ネットリスト | 全ピンが1ネットに属する（NC 除く） |
| T-E2 | electrical | MOSFET・LDO 計算 | 手計算と一致 |
| T-B1 | pcb/drc | 意図的なクリアランス違反 | 違反を検出 |
| T-B2 | pcb/router | 2ピン単純ネット | 配線成功、DRC 合格 |
| T-B3 | pcb/gerber | 出力構文 | 形式指定・アパーチャ・終端 `M02*` を含む |
| T-A1 | airframe/mass | 直方体・円柱の慣性 | 解析解と一致 |
| T-A2 | airframe/mesh | 立方体メッシュ | 体積・watertight 判定が正しい |

## 2. 統合テスト（段階ゴール）

`requirements.md` の G1-1〜G5-2 をそのままスクリプトで判定する。

| 段階 | スクリプト | 出力 |
|---|---|---|
| 1 | `npm run stage1` | `out/stage1/results.json`、`reports/stage1.html` |
| 2 | `npm run stage2` | 回路図 SVG、BOM、`reports/stage2.html` |
| 3 | `npm run stage3` | Gerber ZIP、3D アーカイブ、`reports/stage3.html` |
| 4 | `npm run stage4` | STL、`reports/stage4.html` |
| 5 | `npm run stage5` | `reports/stage5.html`、`reports/index.html` |

## 3. 静的検査

- `npm run typecheck`（tsc --noEmit）
- `npm run lint`（ESLint。`no-explicit-any` をエラーにする）

## 改良版 B

| ID | 内容 | 期待値 |
|---|---|---|
| T-V1 | 子基板回路のネットリスト | 全ピンが 2 ピン以上のネットに属する（NC 除く） |
| T-V2 | GNSS コネクタ有無 | 版 A の回路は不変、版 B は J8 と GNSS_TX/RX が増える |
| T-V3 | GNSS バイアス誤差 | 長時間平均で σ に近い標準偏差、τ で相関 |
| 統合 | `npm run variantB` | GB-1〜GB-5 の判定と比較レポート |

## 改良版 C

| ID | 内容 | 期待値 |
|---|---|---|
| T-C1 | 推進系探索の分離 | 版 A の探索結果は不変、屋外候補で 95 g 未満の解がある |
| T-C2 | 版 C 回路 | MOSFET なし、降圧器・ESC 端子あり、1 ピンのネットなし、電気計算合格 |
| T-C3 | RTH | 通信断後にホーム付近へ戻って着陸する |
| 統合 | `npm run variantC` | GC-1〜GC-7 の判定とレポート |
