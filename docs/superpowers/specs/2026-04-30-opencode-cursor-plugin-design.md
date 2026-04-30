# OpenCode Cursor SDK カスタムツールプラグイン 設計書

- **作成日**: 2026-04-30
- **対象**: `opencode-cursor-plugin` リポジトリ
- **ステータス**: ドラフト（レビュー第 2 回反映済み）

## 改訂履歴

| 日付 | 版 | 変更概要 |
|---|---|---|
| 2026-04-30 | v1 | 初版 |
| 2026-04-30 | v2 | レビュー 2 回目反映: TDD 計画明記 / エッジケース具体化 / `@cursor/sdk` API 確定（`agent.send` + `run.wait` + `ModelSelection` + `CursorAgentError` サブクラス）|
| 2026-04-30 | v3 | レビュー 3 回目反映: (1) §5.3 / §10.1 / §11 T2/T3 の `model` 必須化（local モード制約に整合、未指定時は `DEFAULT_LOCAL_MODEL = "composer-2"` を substitute）/ (2) §7.1 `run.status` エラー時のログ出力を「`result` 全体」から「サニタイズ済みメタ情報のみ」に変更（§6 機微情報保護ポリシーとの衝突解消）/ (3) §3 アーキテクチャ図 fence に `text` 言語指定を追加（MD040）|

## 1. 目的とスコープ

OpenCode のプラグインアーキテクチャに準拠し、Cursor 公式 SDK (`@cursor/sdk`) 経由で Cursor エージェントを呼び出す単一のカスタムツール `cursor_prompt` を提供する。OpenCode セッション中、ユーザは任意のプロンプトを Cursor エージェントへ送信して応答テキストを取得できる。

**スコープ外:**

- Web サーバや外部 API ゲートウェイの構築
- 複数ツールの同時実装（将来の拡張余地は残すが、現時点では1ツールに集中）
- ストリーミング応答、トークン制御、システムプロンプト等の高度な調整パラメータ（YAGNI）

## 2. 採用アプローチと判断根拠

| 設計判断 | 採用案 | 根拠 |
|---|---|---|
| ツール用途 | 汎用プロンプト実行（A 案） | 仕様の「推測による追加機能を実装しない」制約に最も忠実。Cursor SDK の薄いラッパーとして将来拡張容易 |
| 引数構成 | `prompt` 必須 + `model` 任意（B 案） | LLM 呼び出しでモデル選択は実用上ほぼ必須。`systemPrompt` 等は YAGNI |
| ロギング | `client.app.log.{debug,info,warn,error}` | 仕様で `console.log` 禁止が明記。レベル分けで運用観測性を確保 |
| 環境変数読込 | `dotenv.config()` をモジュール初期化時 1 回 | 仕様で `dotenv` 利用が明記。複数回呼び出しを回避 |
| Devcontainer 強制 | `.devcontainer/devcontainer.json` を配置 | 仕様で「テスト・静的解析は必ず Devcontainer 内」と要求 |

## 3. アーキテクチャ概要

```text
[OpenCode Runtime]
      │ load plugin (.opencode/plugins/custom-tools.ts)
      ▼
[CustomToolsPlugin] ── async ({ client }) => { tool: { cursor_prompt } }
      │ on tool call
      ▼
[execute(args)]
   ├─ validate process.env.CURSOR_API_KEY (missing → log.error + throw)
   ├─ resolve model: args.model ?? DEFAULT_LOCAL_MODEL ("composer-2")
   ├─ Agent.create({ apiKey, model: { id }, local: { cwd } })
   ├─ agent.send(args.prompt)               // → Run
   ├─ run.wait()                            // → RunResult
   └─ result.status === "finished" ? result.result : throw
```

## 4. コンポーネント構成

| パス | 役割 |
|---|---|
| `.opencode/plugins/custom-tools.ts` | プラグインエントリ。`cursor_prompt` ツール定義 |
| `package.json` | 依存（`@cursor/sdk`, `zod`, `dotenv`）と TS 開発依存 |
| `.devcontainer/devcontainer.json` | Node.js 20 + pnpm 環境 |
| `tests/cursor-prompt.test.ts` | `cursor_prompt` ツールのユニットテスト（vitest） |
| `vitest.config.ts` | vitest 設定 |

## 5. ツール仕様

### 5.1 メタ情報

- **name**: `cursor_prompt`
- **description**: 「Cursor エージェントへ任意のプロンプトを送信し、応答テキストを取得します。引数 prompt は必須、model はオプション（未指定時は Cursor SDK のデフォルトモデルを使用）。」

### 5.2 args（Zod スキーマ）

```ts
z.object({
  prompt: z.string().min(1).describe("Cursor エージェントへ送信するユーザープロンプト本文"),
  model: z.string().min(1).optional().describe("Cursor 側で利用するモデル識別子（例: 'composer-2'）。未指定の場合は SDK のデフォルトを使用"),
})
```

利用者の API は文字列で受け取り、内部で SDK の `ModelSelection` 形式 `{ id: model }` にラップする（user ergonomics 優先）。

### 5.3 execute フロー

1. `process.env.CURSOR_API_KEY` を取得し、欠落時は `log.error` 後に `Error` を throw
2. 利用モデル ID を解決する: `const resolvedModelId = args.model ?? DEFAULT_LOCAL_MODEL`（`DEFAULT_LOCAL_MODEL = "composer-2"`、§10.1 で確定）。`args.model` 未指定時は `log.warn` でデフォルトモデル `"composer-2"` を適用したことを記録
3. `Agent.create({ apiKey, model: { id: resolvedModelId }, local: { cwd: process.cwd() } })` でエージェント生成（`log.info`）。local モードでは `model` が必須のため、必ず解決済み ID を渡す
4. `agent.send(args.prompt)` を呼び出して `Run` を取得（`log.info`）
5. `await run.wait()` で完了を待ち、`RunResult` を取得
6. `result.status === "finished"` の場合のみ `result.result`（`string`）を return
7. `result.status === "error"` または `"cancelled"` の場合は `log.error` でサニタイズ済みメタ情報のみ記録後 `Error` を throw（詳細は §7.1 / §6 を参照）
8. SDK 例外（`CursorAgentError` 系）は `log.error` 後 re-throw（OpenCode 側でユーザーに伝達される前提）
9. `agent.close()` を `finally` 句で呼び出し、リソースリーク防止

### 5.4 戻り値

- 型: `Promise<string>`
- 内容: `RunResult.result` プロパティ（Cursor エージェントの最終応答テキスト）

## 6. ロギング戦略

| レベル | タイミング | 含める情報 |
|---|---|---|
| `debug` | 呼び出し直後 | `promptLength`, `model`（API キー、プロンプト本文は含めない） |
| `info` | エージェント生成 / プロンプト送信 / 完了 | `responseLength` 等のメタ情報 |
| `warn` | `model` 未指定 | デフォルトモデルへフォールバック |
| `error` | API キー欠落 / SDK 例外 | エラーメッセージ（スタックは SDK 側ログに委譲） |

**機微情報の保護**: `CURSOR_API_KEY` の値、`prompt` 本文、`response` 本文はログに出力しない。長さ等のメタ情報のみ記録。

## 7. エラーハンドリングとエッジケース

### 7.1 エラーケース別動作

| 失敗ケース | 検出箇所 | 動作 | 期待される出力 |
|---|---|---|---|
| `CURSOR_API_KEY` 未設定 | `execute` 冒頭 | `log.error` → `Error("CURSOR_API_KEY is not set...")` を throw | OpenCode 側でツール呼び出しが失敗し、ユーザにメッセージ表示 |
| `prompt` が空文字 | OpenCode ランタイム（Zod） | プラグインに到達せず Zod が自動拒否 | Zod のバリデーションエラーメッセージ |
| `prompt` が極端に長い（例: 100 万文字） | プラグイン側ではチェックせず SDK に委譲 | SDK が `RateLimitError` または `ConfigurationError`（コンテキスト超過）を throw → `log.error` 後 re-throw | エラーメッセージにレート/コンテキスト超過の旨が含まれる |
| `model` が空文字 | OpenCode ランタイム（Zod `.min(1)`） | プラグインに到達せず Zod が自動拒否 | Zod のバリデーションエラーメッセージ |
| `model` が SDK で未知の識別子 | `Agent.create` または初回 `send` 時 | `ConfigurationError` を catch → `log.error` 後 re-throw | エラーメッセージに無効モデル名の旨が含まれる |
| 認証失敗（無効な API キー） | `Agent.create` または `agent.send` 内 | `AuthenticationError` を catch → `log.error` 後 re-throw | エラーメッセージに認証失敗の旨が含まれる |
| ネットワーク失敗 | `Agent.create` または `agent.send` 内 | `NetworkError` を catch → `error.isRetryable` をログに記録後 re-throw（リトライは行わない） | エラーメッセージにネットワーク失敗の旨が含まれる |
| レート制限 | `agent.send` 中 | `RateLimitError` を catch → `log.error` 後 re-throw | エラーメッセージにレート制限の旨が含まれる |
| `run.status === "error"` | `run.wait()` 後 | `log.error` でサニタイズ済みメタ情報のみ記録（`runId`, `status`, あれば `error.code`/`error.message` の長さ等。`result.result` 等の応答本文は含めない） → `Error("Cursor run finished with status=error")` を throw | エラーメッセージに run の id と status |
| `run.status === "cancelled"` | `run.wait()` 後 | 同上のサニタイズ済みメタ情報のみ記録、`Error("Cursor run was cancelled")` を throw | エラーメッセージに cancellation の旨 |
| その他 `CursorAgentError` 派生 | 任意 | `log.error` 後 re-throw | エラーメッセージとサブクラス名 |

### 7.2 エッジケースの設計判断

- **入力長の事前チェックは行わない**: SDK 側がコンテキスト長と料金を一元管理するため、プラグイン側で重複バリデーションを置かない（DRY）。SDK のエラーをそのまま伝搬する。
- **リトライは実装しない**: `NetworkError.isRetryable` を尊重するリトライロジックは YAGNI。OpenCode ユーザが必要に応じてツールを再呼び出しする想定。
- **`prompt` 本文・`response` 本文はログに出さない**: 機微情報保護のため長さのみ記録。

### 7.3 リソース管理

- `agent.close()` を `finally` 句で必ず呼び出す。例外発生時もリーク防止。
- 例外時の `agent` 未生成ケース（`Agent.create` 自体が throw）は `try/finally` の中で `agent` が `undefined` 判定で skip。

## 8. Devcontainer 構成

- **ベースイメージ**: `mcr.microsoft.com/devcontainers/typescript-node:20`
- **pnpm 有効化**: `corepack enable && corepack prepare pnpm@9.12.0 --activate`
- **`postCreateCommand`**: pnpm 有効化に続いて `pnpm install`
- **環境変数連携**: `remoteEnv.CURSOR_API_KEY` をホストの `localEnv` から透過パススルー
- **VS Code/Cursor 拡張**: `dbaeumer.vscode-eslint`, `esbenp.prettier-vscode`, `anysphere.cursorpyright`
- **設定**: `editor.formatOnSave: true`, `typescript.tsdk: node_modules/typescript/lib`

## 9. 依存関係

| パッケージ | 種別 | 用途 |
|---|---|---|
| `@cursor/sdk` | dependency | Cursor エージェント呼び出し |
| `zod` | dependency | 引数スキーマ定義・検証 |
| `dotenv` | dependency | `.env` 経由の `CURSOR_API_KEY` 読込 |
| `@opencode-ai/plugin` | devDependency | `Plugin` / `tool` 型・ヘルパー |
| `typescript` | devDependency | 型チェック |
| `@types/node` | devDependency | `process.env` 等の型 |
| `vitest` | devDependency | ユニットテストランナー（TDD） |

## 10. 前提条件と確定事項

### 10.1 確定済み（公式ドキュメント検証済 / 2026-04-30 時点）

公式 TypeScript SDK ドキュメント (`https://cursor.com/docs/sdk/typescript`) および公式ブログを参照して以下を確定した：

- **`Agent.create(options)`** は `Promise<SDKAgent>` を返す。`options` は次を含む:
  - `apiKey: string`（必須。未指定時は環境変数 `CURSOR_API_KEY` から自動取得）
  - `model: ModelSelection`（**local モードでは必須**。形式: `{ id: string }`）。本設計では local モードを採用するため、ユーザが `args.model` を省略した場合でも実装層で `DEFAULT_LOCAL_MODEL = "composer-2"` を substitute して `Agent.create` には常に解決済みの ID を渡す
  - `local | cloud`: ランタイム設定（いずれか一方が必須。本設計では `local: { cwd: process.cwd() }` を採用）
- **プロンプト送信メソッド**は `agent.send(message: string | SDKUserMessage, options?): Promise<Run>`
- **完了取得**は `await run.wait()` で `RunResult` を返す。`RunResult.result: string` に最終応答テキスト、`RunResult.status: "finished" | "error" | "cancelled"`
- **エラー型**は `CursorAgentError`（基底）と派生クラス: `AuthenticationError` / `RateLimitError` / `ConfigurationError` / `IntegrationNotConnectedError` / `NetworkError` / `UnknownAgentError`
- **リソース解放**は `agent.close()` または `Symbol.asyncDispose`
- **デフォルトモデル**は Composer 2（`composer-2`）

### 10.2 残存する前提

- **`@opencode-ai/plugin` のバージョン**: 想定 `^0.4.0`。実環境の OpenCode と整合しないバージョンが配布されている場合は固定する必要がある。
- **`SDKUserMessage` 形式の活用**: 本設計では `string` 引数のみ使用（YAGNI）。マルチモーダル等の将来拡張時に検討。

## 11. テスト戦略（TDD）

本実装スコープに自動テストを含める。実装に先立ちテストを書き Red → Green → Refactor で進める。

### 11.1 採用ツール

- **テストランナー**: `vitest`（ESM ネイティブ・TS サポート・モック機能内蔵）
- **モック戦略**: `vi.mock("@cursor/sdk")` で `Agent` クラスをスタブ化。`client.app.log` は `vi.fn()` のセットで代替

### 11.2 テスト対象と Red ケース一覧

`tests/cursor-prompt.test.ts` に以下のテストケースを実装する：

| # | ケース | Arrange | Act | Assert |
|---|---|---|---|---|
| T1 | API キー欠落 | `process.env.CURSOR_API_KEY` を `delete` | `execute({ prompt: "hi" })` | `Error` が throw され、メッセージに `CURSOR_API_KEY` を含む。`log.error` が 1 回呼ばれる |
| T2 | 正常系（model 未指定 → デフォルト substitute） | API キー設定。`Agent.create` モックが `agent.send` → `run.wait` → `{ status: "finished", result: "ok" }` を返却 | `execute({ prompt: "hi" })` | 戻り値 `"ok"`。`Agent.create` の `model` 引数が `{ id: "composer-2" }`（DEFAULT_LOCAL_MODEL）。`log.warn` が呼ばれ、デフォルト適用が記録されている |
| T3 | 正常系（model 明示指定） | 同上 + `args.model = "composer-2"` | `execute({ prompt: "hi", model: "composer-2" })` | `Agent.create` の `model` 引数が `{ id: "composer-2" }`。`log.warn` は呼ばれない |
| T4 | 極端に長い prompt（SDK が `RateLimitError`） | `agent.send` モックが `RateLimitError` を throw | `execute({ prompt: "x".repeat(1_000_000) })` | `RateLimitError` がそのまま throw。`log.error` 呼び出し |
| T5 | 不正なモデル名（`ConfigurationError`） | `Agent.create` モックが `ConfigurationError("unknown model")` を throw | `execute({ prompt: "hi", model: "no-such-model" })` | `ConfigurationError` がそのまま throw。`log.error` 呼び出し |
| T6 | 認証失敗 | `Agent.create` モックが `AuthenticationError` を throw | `execute(...)` | `AuthenticationError` がそのまま throw |
| T7 | ネットワーク失敗 | `agent.send` モックが `NetworkError({ isRetryable: true })` を throw | `execute(...)` | `NetworkError` がそのまま throw。`log.error` の引数に `isRetryable: true` を含む |
| T8 | `run.status === "error"` | `run.wait()` モックが `{ status: "error" }` を返却 | `execute(...)` | `Error` が throw され、メッセージに `status=error` を含む |
| T9 | `run.status === "cancelled"` | 同上 `{ status: "cancelled" }` | `execute(...)` | `Error` が throw され、メッセージに `cancelled` を含む |
| T10 | `agent.close` 呼び出し | 正常系・例外系の両方 | `execute(...)` | `agent.close` がいずれの場合も呼ばれている（`finally` の動作確認）|
| T11 | ログに `prompt` 本文が含まれない | 正常系 | `execute({ prompt: "secret-content" })` | 全 `log.*` の呼び出し引数に `"secret-content"` 文字列が含まれない |
| T12 | ログに `apiKey` が含まれない | API キーを `"sk-test-12345"` で設定 | `execute(...)` | 全 `log.*` の呼び出し引数に `"sk-test-12345"` が含まれない |

### 11.3 Zod バリデーションのテスト範囲

`args` の Zod スキーマ自体のテスト（空文字 `prompt` 拒否など）は OpenCode ランタイムが担当するためプラグイン側ではテストしない。スキーマ定義の存在のみ確認（T2 〜 T3 の正常系で間接的にカバー）。

### 11.4 テストコマンド

- `pnpm test`: vitest を 1 回実行
- `pnpm test:watch`: 変更検知ループ（開発時）

すべて Devcontainer 内で実行することを前提とする（仕様 4 を尊重）。

## 12. 受け入れ条件

1. Devcontainer 起動後 `pnpm install` が成功する。
2. `pnpm typecheck` がエラーなく完了する。
3. `pnpm test` でユニットテスト（T1 〜 T12）が全て pass する。
4. `CURSOR_API_KEY` 設定済みの環境で OpenCode から `cursor_prompt` ツールが起動可能。
5. `CURSOR_API_KEY` 未設定時、ツール実行が明確なエラーメッセージで失敗する。
6. ツール実行ログが `client.app.log` の各レベルで出力され、`console.log` は一切使用されていない。
