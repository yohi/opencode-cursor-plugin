# opencode-cursor-plugin

OpenCode 用カスタムツールプラグイン。Cursor 公式 SDK (`@cursor/sdk`) 経由で Cursor エージェントへ任意のプロンプトを送信し、応答テキストを返す `cursor_prompt` ツールを 1 つ提供する。

詳細な仕様については [SPEC.md](./SPEC.md) を参照してください。

## AIエージェント用インストールプロンプト

> [!TIP]
> **人間は設定を打ち間違えることがあります。** このプロジェクト（プラグイン）のインストールと設定は、AIエージェント（OpenCode / Claude Code / Cursor 等）に丸投げすることを強く推奨します。

Install and configure opencode-cursor-plugin by following the instructions here:
https://raw.githubusercontent.com/yohi/opencode-cursor-plugin/refs/heads/master/README.md

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
     2. ユーザーに `YOUR_GITHUB_TOKEN` を設定するよう促すか、既存の環境変数を利用してください。
     3. プロジェクトの `opencode.json`（または `oh-my-opencode.jsonc`等）を開き、`plugins` オブジェクト内に `"@yohi/opencode-cursor-plugin": {}` を追加してください。
   * **ソースコードから利用する場合**:
     1. `opencode.json`（または `oh-my-opencode.jsonc`等）を開き、`plugins` オブジェクト内に `.opencode/plugins/custom-tools.ts` へのパスを指定する設定を追加してください。
3. **[ ] 環境変数の設定:**
   * プロジェクトの `.env` ファイルに `CURSOR_API_KEY` を追加するようユーザーに促してください。
</details>

## 提供ツール

### `cursor_prompt`

| 引数 | 型 | 必須 | 説明 |
|---|---|---|---|
| `prompt` | string | ○ | Cursor エージェントへ送信するユーザープロンプト本文 |
| `model` | string | × | Cursor 側で利用するモデル識別子（例: `composer-2`, `claude-3-5-sonnet`）。未指定時は `composer-2` を使用 |

戻り値: `Promise<string>`（Cursor エージェントの最終応答テキスト）。

#### 💡 Cursor サブスクリプションを利用したモデルの指定方法

Cursor の Pro プラン等のサブスクリプションを契約している場合、引数 `model` にプレミアムモデルの識別子を指定することで、より高性能な推論を利用可能です。

- **利用可能なモデル例**: `claude-3-5-sonnet`, `gpt-4o`, `gpt-4.5-preview`, `claude-3-7-sonnet` など
- **注意点**: 
  - APIキー (`CURSOR_API_KEY`) はサブスクリプション契約済みのアカウントから取得したものを使用してください。
  - 本プラグイン経由の利用でも、通常の Cursor の利用制限（Premiumリクエスト消費等）が適用されます。

#### 🗣️ 具体的な呼び出しイメージ（使い方）

本プラグインはOpenCodeの「ツール」として追加されるため、OpenCodeへの**自然言語による指示**や、**プロンプトルール（AGENTS.md等）**を通して呼び出します。

**パターン1: チャットで直接指示する**
OpenCodeのチャット上で、利用したいモデルとタスクを明確に伝えます。
> **👤 ユーザー:** 「Cursorの `claude-3-7-sonnet` モデルを使って、このディレクトリにある複雑なエラーの根本原因を深く分析して」
> **🤖 OpenCode:** （自律的に `cursor_prompt` ツールを選択・実行し、`model: "claude-3-7-sonnet"` を指定してCursorへ処理を委譲。Cursorの回答を受け取ってユーザーに報告します）

**パターン2: AGENTS.md（システムプロンプト）でルール化する**
プロジェクトの `AGENTS.md` や指示書に以下のようなルールを記載しておくことで、OpenCodeに特定のタスクを常にCursorの高度なモデルで処理させることができます。
```markdown
- **高度な推論が必要なタスク**: アーキテクチャの設計や難解なバグの解決を行う際は、必ず `cursor_prompt` ツールを使用してください。その際、引数 `model` には必ず `"claude-3-7-sonnet"` を指定し、Cursorの推論能力を活用してください。
```

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

## OpenCode への接続（インストール方法）

本プラグインは GitHub Packages に `@yohi/opencode-cursor-plugin` として公開されています。

1. **`.npmrc` の設定**
   プロジェクトの `.npmrc`（またはグローバルの `~/.npmrc`）に GitHub Packages の認証情報を追加します。（※トークンをソースコード上に直接記述してコミットしないよう、環境変数を利用してください）
   ```ini
   @yohi:registry=https://npm.pkg.github.com
   //npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
   ```

2. **OpenCode へのプラグイン追加**
   プロジェクトの `opencode.json`（または `oh-my-opencode.jsonc`等）の `plugins` セクションに追加します。OpenCode は起動時に npm 経由でこれを自動的にインストールし、ロードします。
   ```json
   {
     "plugins": {
       "@yohi/opencode-cursor-plugin": {}
     }
   }
   ```

※ローカル開発中のソースを直接ロードさせる場合は、引き続き `.opencode/plugins/custom-tools.ts` を指定することも可能です。詳細は OpenCode のプラグインドキュメントを参照してください。
