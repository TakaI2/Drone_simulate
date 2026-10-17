# Drone Design Studio

固定ピッチの多ロータ機（ドローン）を、飛行シミュレーション → 推進系・電気設計 → 基板の自動配置配線 → 機体設計 → 統合検証まで一貫して設計するツールです。ブラウザだけで動きます。

- 屋内（オプティカルフロー）・屋外（GNSS、風、自動帰還）・都市（横浜みなとみらい、PLATEAU の建物）の飛行シミュレーション
- 推進系の探索、回路生成と電気計算、2 層基板の自動配置・配線、Gerber / KiCad 出力
- 3D プリント用フレームの生成（重心・強度・隙間の検証、STL 出力）
- 3 つの設計例（版 A：1S ブラシ付き、版 B：センサ子基板＋GNSS 端子、版 C：屋外用ブラシレス）と予算

使い方は [docs/manual.md](docs/manual.md)、設計の経緯と検証結果は `reports/index.html` を参照してください。

## 開発

```bash
npm install
npm run dev        # http://localhost:5173
npm test
npm run build      # dist/ にサイト一式（アプリ＋out/・reports/・docs/、マニュアルの HTML 版）
```

## 公開（Netlify）

`netlify.toml` に設定済みです（ビルド `npm run build`、公開ディレクトリ `dist`）。Netlify で GitHub リポジトリを連携すると、push のたびに自動で公開されます。設計データ（`out/`）とレポートはリポジトリに含めたものを公開するので、設計を変えたら各スクリプト（`npm run all` など）を実行してから push してください。

## 注意

結果はシミュレーションと計算上の値で、実機の安全性・性能・飛行の可否を保証しません。飛行は法令・条例に従ってください（詳しくは `notice.html`）。

## ライセンス

ソースコードは [MIT License](LICENSE)。データ（PLATEAU、OpenStreetMap など）とライブラリのライセンスは [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) を参照してください（`out/city/buildings_osm.json` は ODbL 1.0）。
