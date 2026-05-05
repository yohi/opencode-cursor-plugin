# opencode-cursor-plugin

OpenCode 用 Provider プラグイン。Cursor 公式 SDK (`@cursor-provider/sdk`) を OpenCode のメイン LLM プロバイダーとして登録し、`cursor-provider/composer-2` などのモデルを直接利用できるようにします。

詳細な設計とアーキテクチャについては [SPEC.md](./SPEC.md) を参照してください。

## 🛠 セットアップ

### FOR HUMANS (推奨)

> [!IMPORTANT]
> **人間は設定を打ち間違えることがあります。** このプロジェクトのセットアップは、AIエージェント（OpenCode / Claude Code / Cursor 等）に丸投げすることを強く推奨します。

以下のプロンプトをコピーして、お使いのAIエージェント（OpenCode, Claude Code, Cursor等）に貼り付けてください。

```text
Install and configure opencode-cursor-plugin. First, read the local README.md and SPEC.md in this repository. You MUST use your interaction tool (e.g., ask_user, input) to let me choose the installation method BEFORE executing any other commands.
```

### FOR AGENTS

<details>
<summary><b>詳細な手順を表示</b></summary>

あなたがターミナル操作可能なAIエージェントであるなら、対象プロジェクトへこのプラグインをインストールするために以下の手順を自律的に遂行してください：

1. **[ ] インストール方法の確認:**
   * あなたの持つ `ask_user` 等のツールを使用して、ユーザーに「GitHub Packages 経由でインストールするか」または「ソースコードをクローンして利用するか」を質問し、方針を決定してください。
2. **[ ] 選択に応じたセットアップの実行:**
   * **GitHub Packages を選択した場合**:
     1. プロジェクトルートの `.npmrc`（存在しない場合は作成）に、以下の2行を追記してください。
        ```ini
        @yohi:registry=https://npm.pkg.github.com
        //npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
        ```
     2. ユーザーに `GITHUB_TOKEN` を設定するよう促すか、既存の環境変数を利用してください。
     3. プロジェクトの `opencode.jsonc`（または `opencode.json`）を開き、`plugin` 配列内に `"@yohi/opencode-cursor-plugin"` を追加してください。
   * **ソースコードから利用する場合**:
     1. `opencode.jsonc`（または `opencode.json`）を開き、`plugin` 配列内に `./.opencode/plugins/cursor-provider/index.ts` へのパスを追加してください。
3. **[ ] 環境変数の設定:**
   * プロジェクトの `.env` ファイルに `CURSOR_API_KEY` を追加するようユーザーに促すか、`opencode auth login cursor` の使用を提案してください。
</details>

## v0.2.0 (BREAKING CHANGE)

- 旧 `cursor_prompt` カスタムツールは削除されました。
- Cursor は OpenCode のメイン LLM プロバイダーとして直接利用できます。
- 認証は `opencode auth login cursor` または `CURSOR_API_KEY` を利用します。

## 提供プロバイダー

### `cursor`

OpenCode は `cursor` プロバイダーを通じて Cursor SDK のモデルに直接アクセスします。

- **プレフィックス**: `cursor-provider/` を使用します。
- **利用例**: `cursor-provider/composer-2` (推奨), `cursor-provider/claude-3-7-sonnet`, `cursor-provider/gpt-4o`

## 設定方法 (`opencode.jsonc`)

### 1. プロバイダーの有効化 (デフォルト設定)

OpenCode のデフォルトプロバイダーとして登録する場合の設定例です。

```jsonc
{
  "provider": {
    "default": "cursor-provider/composer-2"
  },
  "plugin": [
    ["./.opencode/plugins/cursor-provider/index.ts", {}]
  ]
}
```

### 2. モデルの制限 (`whitelist`)

特定のモデルのみを許可したい場合は、`whitelist` を設定できます。

```jsonc
{
  "provider": {
    "cursor-provider": {
      "whitelist": [
        "composer-2",
        "claude-3-7-sonnet"
      ]
    }
  }
}
```

## 認証

プロバイダーを利用するには、以下のいずれかの方法で認証を行う必要があります。

```bash
# コマンドでインタラクティブに設定
opencode auth login cursor

# または環境変数で設定
export CURSOR_API_KEY="..."
```

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

## インストール方法

GitHub Packages 版を利用する場合は `.npmrc` に以下を設定します。

```ini
@yohi:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

`opencode.json` / `opencode.jsonc` の `plugin` には npm パッケージを追加できます。

```jsonc
{
  "provider": { "default": "cursor-provider/composer-2" },
  "plugin": [
    "@yohi/opencode-cursor-plugin"
  ]
}
```

ローカル開発中のソースを直接ロードさせる場合は `./.opencode/plugins/cursor-provider/index.ts` を指定してください。
