# Guidelines（Drone Design Studio）

飛行体（固定ピッチ・非偏向の多ロータ機）のシミュレーション・電気設計・基板設計・機体設計を一貫して支援するツールを開発するプロジェクト。
元の要望は `plan.txt`、精査済み要件は `.tmp/requirements.md`、設計は `.tmp/design.md` を正とする。

## Top-Level Rules

- 独立した処理は並列でツールを呼び出す。
- 思考は英語、ユーザーへの応答は日本語で行う。
- ライブラリの使い方は、インストール済みパッケージの型定義・README を一次情報とする（Context7 MCP があれば併用してよい）。
- 設計メモは `.tmp` に markdown で保存する。
- Write/Edit 後は実ファイルの内容を確認する。
- ユーザーの意見に迎合せず、批判的に、ただし押し付けずに応答する。

## Programming Rules

- 値のハードコードを避け、プリセット・設定（`src/core/presets.ts` 等）に外出しする。
- TypeScript で `any` / `unknown` を使わない。
- `class` は原則使わない（`Error` 派生など必須の場合のみ）。状態はクロージャとプレーンオブジェクトで持つ。
- コア計算（`src/core`〜`src/integration`）は DOM に依存させない。Node でテスト・バッチ実行できること。

## Project Conventions

- 座標系: ワールドは ENU（z 上）、機体は FLU。three.js も z 上に揃える。
- 単位: 物理・制御・サイジングは SI。基板・機体形状は mm。
- ロータ回転方向 `spin`: 上から見て CCW を +1。
- 乱数はシード固定（再現性のため）。

## License Policy

- 本体に取り込む依存は MIT / BSD / Apache 系のみ。
- GPL のプロジェクト（ArduPilot、Betaflight、ESP-Drone、AM32、Freerouting 等）はコードを取り込まず、設計の参考に留める。
- 参考元は `.tmp/requirements.md` のライセンス表とレポートに明記する。

## Commands

- `npm run dev` — UI 開発サーバ
- `npm test` — 単体テスト
- `npm run typecheck` / `npm run lint`
- `npm run stage1`〜`stage5` — 段階ゴールの判定、成果物とレポート（`reports/`）の生成
- `npm run variantB` / `variantC` — 改良版 B（センサ子基板＋GNSS 端子）・改良版 C（屋外機）の判定とレポート

## Development Style

- 新機能は要件（`.tmp/requirements.md`）→設計（`.tmp/design.md`）→テスト設計（`.tmp/test_design.md`）→タスク（`.tmp/tasks.md`）→実装の順で進める。
- 段階（1〜5）はゴール判定スクリプトに合格したら次へ進む。各段階で試行経過・スクリーンショット・懸念点を HTML レポートに残す。
- ユーザーが自律実行を指示している場合、段階間の確認待ちはしない。
- 軽微な修正・明確なバグ修正は直接実装してよい。
