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
     3. プロジェクトの `opencode.json`（または `opencode.jsonc`等）を開き、`plugin` 配列内に `"@yohi/opencode-cursor-plugin"` を追加してください。
   * **ソースコードから利用する場合**:
     1. `opencode.json`（または `opencode.jsonc`等）を開き、`plugin` 配列内に `./src/index.ts` へのパスを指定する設定を追加してください。
3. **[ ] 環境変数の設定:**
   * プロジェクトの `.env` ファイルに `CURSOR_API_KEY` を追加するようユーザーに促すか、`opencode auth login cursor` の使用を提案してください。
</details>

## v0.3.0 (Latest)

- **2026年モデルへの完全対応**: `composer-2`, `claude-4.6-sonnet`, `gpt-5.5` などの最新フラッグシップモデルをサポート。
- **動的なモデル解決**: 起動時に Cursor API から最新のモデルリストとコンテキストウィンドウ情報を自動取得。
- **マルチエージェント対応の最適化**: 内部の AgentPool を改善し、OpenCode からの並列リクエストに対する耐性を強化。

## v0.2.0 (BREAKING CHANGE)

- 旧 `cursor_prompt` カスタムツールは削除されました。
- Cursor は OpenCode のメイン LLM プロバイダーとして直接利用できます。
- プラグインが起動時に `provider.cursor` を自動設定します。`opencode.jsonc` に手で provider 定義を書く必要はありません。
- 認証は `opencode auth login cursor` または `CURSOR_API_KEY` を利用します。

## 提供プロバイダー

### `cursor`

利用例: `cursor/composer-2`, `cursor/claude-4-6-sonnet`, `cursor/gpt-5-5`, `cursor/gemini-3-1-pro`

OpenCode は Provider 経由で直接ストリーミング応答を受け取ります。
本プラグインは起動時に Cursor の最新モデル一覧を動的に取得します。オフライン時や取得失敗時は、`composer-2` や `claude-4-6-sonnet` を含む静的なフォールバックリストが利用されます。

`provider.cursor.whitelist` を設定すると、モデル一覧を特定のモデルに絞れます。未設定の場合は取得されたすべてのモデルが表示されます。

## 必須環境変数

- `CURSOR_API_KEY`: Cursor API キー。`opencode auth login cursor` を使わない場合に必要です。

`.env` を利用する場合は `.env.example` をコピーして値を設定します。

```bash
cp .env.example .env
# .env を編集して CURSOR_API_KEY を設定
```

## 依存関係

本プラグインは Cursor SDK を使用しています。SDK は現在ベータ版であり、破壊的変更を含むアップデートが頻繁に行われるため、動作確認済みのバージョンを固定して使用しています。

- **Cursor SDK**: `@cursor/sdk@1.0.12`

## 開発環境 (Required)

ローカル開発・テスト・静的解析はすべて `.devcontainer/` の Devcontainer 内で実行してください。Node.js 20+ と `sqlite3` ネイティブモジュールの再現性を保つため、ホスト OS 上での `pnpm test` / `pnpm typecheck` / `pnpm lint` の実行はレビュー時のエビデンスとして採用されません。

- VS Code / Cursor: コマンドパレットから `Dev Containers: Reopen in Container`
- CLI: `devcontainer up --workspace-folder .` 後、`devcontainer exec --workspace-folder . pnpm <command>`

## 設定方法

1. プラグインを読み込むように `opencode.jsonc` を設定します。

```jsonc
{
  "provider": {
    "default": "cursor/composer-2"
  },
  "plugin": [
    ["./src/index.ts", {}]
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

`cursor/composer-2` や `cursor/claude-4-6-sonnet` が表示されれば設定完了です。

## 設定例 (`opencode.jsonc`)

```jsonc
{
  "provider": {
    "default": "cursor/composer-2"
  },
  "plugin": [
    ["./src/index.ts", {}]
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

ローカル開発中のソースを直接ロードさせる場合は `./src/index.ts` を指定してください。

このプラグインは起動時に `provider.cursor` を補完するため、通常の利用では `provider.cursor` を手で記述する必要はありません。
