# OpenCode Cursor Provider プラグイン仕様書 (SPEC.md)

このファイルは旧 `cursor_prompt` ツール仕様の要約ではなく、Provider ベース実装への移行案内として扱います。現行の詳細設計は `docs/superpowers/specs/2026-05-03-cursor-provider-v2-design.md` を正とします。

## 現行仕様の参照先

- 詳細設計: [`docs/superpowers/specs/2026-05-03-cursor-provider-v2-design.md`](./docs/superpowers/specs/2026-05-03-cursor-provider-v2-design.md)
- 実装計画: [`docs/superpowers/plans/2026-05-03-cursor-provider-v2-implementation.md`](./docs/superpowers/plans/2026-05-03-cursor-provider-v2-implementation.md)

## 移行サマリ

- `cursor_prompt` カスタムツールは削除されました。
- プラグインのエントリポイントは `.opencode/plugins/cursor-provider/index.ts` です。
- OpenCode では `cursor/composer-2` などを Provider として直接選択します。
- 認証は `opencode auth login cursor` または `CURSOR_API_KEY` を使います。

## 旧仕様について

旧ツール実装を前提にした記述は破棄し、新規の判断は Provider 設計書に従ってください。
