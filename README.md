# opencode-cursor-plugin

OpenCode 用 Provider プラグイン。Cursor 公式 SDK (`@cursor/sdk`) を OpenCode から使えるようにし、起動時に `provider.cursor` を自動注入して `cursor/composer-2` などのモデルを利用できるようにします。

詳細な設計とアーキテクチャについては [SPEC.md](./SPEC.md) を参照してください。

## AIエージェント用インストールプロンプト

> [!TIP]
> **人間は設定を打ち間違えることがあります。** このプロジェクト（プラグイン）のインストールと設定は、AIエージェント（OpenCode / Claude Code / Cursor 等）に丸投げすることを強く推奨します。

<details>
<summary><b>For Agents (AIエージェント向け手順)</b></summary>

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
      3. プロジェクトの `opencode.json`（または `oh-my-opencode.jsonc`等）を開き、`plugin` 配列内に `"@yohi/opencode-cursor-plugin"` を追加してください。
   * **ソースコードから利用する場合**:
     1. `opencode.json`（または `oh-my-opencode.jsonc`等）を開き、`plugin` 配列内に `.opencode/plugins/cursor-provider/index.ts` へのパスを指定する設定を追加してください。
3. **[ ] 環境変数の設定:**
   * プロジェクトの `.env` ファイルに `CURSOR_API_KEY` を追加するようユーザーに促すか、`opencode auth login cursor` の使用を提案してください。
</details>

## v0.2.0 (BREAKING CHANGE)

- 旧 `cursor_prompt` カスタムツールは削除されました。
- Cursor は OpenCode のメイン LLM プロバイダーとして直接利用できます。
- プラグインが起動時に `provider.cursor` を自動設定します。`opencode.jsonc` に手で provider 定義を書く必要はありません。
- 認証は `opencode auth login cursor` または `CURSOR_API_KEY` を利用します。

## 提供プロバイダー

### `cursor`

利用例: `cursor/composer-2`, `cursor/claude-3-7-sonnet`, `cursor/gpt-4o`

OpenCode は Provider 経由で直接ストリーミング応答を受け取ります。

`provider.cursor.whitelist` を設定すると、モデル一覧を特定のモデルに絞れます。未設定の場合はプラグイン側の既定モデルが表示されます。

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

## 設定方法

1. プラグインを読み込むように `opencode.jsonc` を設定します。

```jsonc
{
  "provider": {
    "default": "cursor/composer-2"
  },
  "plugin": [
    ["./.opencode/plugins/cursor-provider/index.ts", {}]
  ]
}
```

2. 必要に応じて `provider.cursor.whitelist` を指定します。

```jsonc
{
  "provider": {
    "cursor": {
      "whitelist": ["composer-2"]
    }
  }
}
```

3. 認証します。

```bash
opencode auth login cursor
# または
export CURSOR_API_KEY="..."
```

4. 動作確認します。

```bash
opencode models cursor
```

`cursor/composer-2` が表示されれば設定完了です。

## 設定例 (`opencode.jsonc`)

```jsonc
{
  "provider": {
    "default": "cursor/composer-2"
  },
  "plugin": [
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

`opencode.json` / `opencode.jsonc` の `plugin` には npm パッケージを追加できます。

```jsonc
{
  "provider": { "default": "cursor/composer-2" },
  "plugin": ["@yohi/opencode-cursor-plugin"]
}
```

ローカル開発中のソースを直接ロードさせる場合は `.opencode/plugins/cursor-provider/index.ts` を指定してください。

このプラグインは起動時に `provider.cursor` を補完するため、通常の利用では `provider.cursor` を手で記述する必要はありません。
