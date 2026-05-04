# opencode-cursor-plugin

OpenCode 用 Provider プラグイン。Cursor 公式 SDK (`@cursor/sdk`) を OpenCode のメイン LLM プロバイダーとして登録し、`cursor/composer-2` などのモデルを直接利用できるようにします。

詳細な設計は [docs/superpowers/specs/2026-05-03-cursor-provider-v2-design.md](./docs/superpowers/specs/2026-05-03-cursor-provider-v2-design.md) を参照してください。

## v0.2.0 (BREAKING CHANGE)

- 旧 `cursor_prompt` カスタムツールは削除されました。
- Cursor は OpenCode のメイン LLM プロバイダーとして直接利用できます。
- 認証は `opencode auth login cursor` または `CURSOR_API_KEY` を利用します。

## 提供プロバイダー

### `cursor`

利用例: `cursor/composer-2`, `cursor/claude-3-7-sonnet`, `cursor/gpt-4o`

OpenCode は Provider 経由で直接ストリーミング応答を受け取ります。

## 必須環境変数

- `CURSOR_API_KEY`: Cursor API キー。`opencode auth login cursor` を使わない場合に必要です。

`.env` を利用する場合は `.env.example` をコピーして値を設定します。

```bash
cp .env.example .env
# .env を編集して CURSOR_API_KEY を設定
```

## 開発（Devcontainer 推奨）

1. VS Code または Cursor IDE で「Dev Containers: Reopen in Container」を実行
2. Devcontainer 内のターミナルで以下を実行

```bash
pnpm install
pnpm typecheck
pnpm test
```

## 設定例 (`opencode.jsonc`)

```jsonc
{
  "provider": {
    "default": "cursor/composer-2"
  },
  "plugins": [
    ["./.opencode/plugins/cursor-provider/index.ts", {}]
  ]
}
```

## 認証

```bash
opencode auth login cursor
# または環境変数
export CURSOR_API_KEY="..."
```

## インストール方法

GitHub Packages 版を利用する場合は `.npmrc` に以下を設定します。

```ini
@yohi:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

`opencode.json` / `opencode.jsonc` の `plugins` には npm パッケージを追加できます。

```jsonc
{
  "provider": { "default": "cursor/composer-2" },
  "plugins": {
    "@yohi/opencode-cursor-plugin": {}
  }
}
```

ローカル開発中のソースを直接ロードさせる場合は `.opencode/plugins/cursor-provider/index.ts` を指定してください。
