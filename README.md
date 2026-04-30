# opencode-cursor-plugin

OpenCode 用カスタムツールプラグイン。Cursor 公式 SDK (`@cursor/sdk`) 経由で Cursor エージェントへ任意のプロンプトを送信し、応答テキストを返す `cursor_prompt` ツールを 1 つ提供する。

## 提供ツール

### `cursor_prompt`

| 引数 | 型 | 必須 | 説明 |
|---|---|---|---|
| `prompt` | string | ○ | Cursor エージェントへ送信するユーザープロンプト本文 |
| `model` | string | × | Cursor 側で利用するモデル識別子（例: `composer-2`）。未指定時は SDK のデフォルトを使用 |

戻り値: `Promise<string>`（Cursor エージェントの最終応答テキスト）。

## 必須環境変数

- `CURSOR_API_KEY`: Cursor API キー。未設定の場合ツール実行時に明示的なエラーで失敗する。

`.env` を利用する場合は `.env.example` をコピーして値を設定する:

```bash
cp .env.example .env
# .env を編集して CURSOR_API_KEY を設定
```

## 開発（Devcontainer 必須）

1. VS Code または Cursor IDE で「Dev Containers: Reopen in Container」を実行
2. Devcontainer 内のターミナルで:

```bash
pnpm install
pnpm typecheck
pnpm test
```

すべてのテスト・静的解析は Devcontainer 内で実行することを前提としている。

## OpenCode への接続

`.opencode/plugins/custom-tools.ts` を OpenCode が自動ロードする想定。詳細は OpenCode のプラグインドキュメントを参照。
