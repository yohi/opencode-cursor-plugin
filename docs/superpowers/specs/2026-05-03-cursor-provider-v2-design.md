# Cursor Provider V2 設計書

- **作成日**: 2026-05-03
- **対象リポジトリ**: `opencode-cursor-plugin`
- **要件参照**: [`PROVIDER_REQUIREMENTS.md`](../../../PROVIDER_REQUIREMENTS.md)
- **対象バージョン**: `@yohi/opencode-cursor-plugin` v0.2.0（破壊的変更）

## 1. 目的とスコープ

OpenCode の `cursor_prompt` カスタムツールを廃止し、`@opencode-ai/plugin` の `ProviderHook` を実装することで、Cursor Headless SDK (`@cursor/sdk`) を **OpenCode のメイン LLM プロバイダー**として直接利用できるようにする。

要件書 `PROVIDER_REQUIREMENTS.md` の Phase 1〜4 全体（PoC・コア実装・トランスレータ／ストリーミング・テスト／ドキュメント整備）を本設計のスコープとする。

### スコープ外

- Cursor アカウントの OAuth 自動ログイン
- OpenCode の MCP ツール群を Cursor 側へ完全同期する機能（Phase 5 以降）
- 実 Cursor API を叩く E2E テストの CI 自動化（手動実行スクリプトとして提供）

## 2. 設計判断サマリ

| # | テーマ | 採用 | 根拠 |
|---|---|---|---|
| 1 | スコープ | 要件書 Phase 1〜4 全体 | ユーザ判断（包括設計） |
| 2 | 既存 `cursor_prompt` ツール | 完全削除 | YAGNI、Provider が代替 |
| 3 | モデル一覧取得 | 動的取得 + 静的フォールバック | 最新モデル反映と起動信頼性の両立 |
| 4 | Cursor のエージェント性 | Pure LLM モード | 二重エージェント問題回避、要件書 2.2 と整合 |
| 5 | 履歴 → Cursor の橋渡し | ハッシュ＋プール最適化 / フルプロンプト fallback | レイテンシ最小化と新規／分岐会話への耐性両立 |
| 6 | プールライフサイクル | LRU 上限 8、close 5 秒タイムアウト | 予測可能でリソース漏洩なし |
| 7 | ストリーミングイベント | text 通常 / thinking → reasoning / tool-call → 警告 | Cursor の表現力を活用しつつ Pure LLM 建前を可視化 |
| 8 | 認証 | env var + `AuthHook`（api タイプ） | UX 改善。OAuth はスコープ外 |
| 9 | OpenCode 標準パラメータ | 初回検出時のみ `warn` | 設定漏れに気付けるがログノイズ最小 |
| 10 | 命名 | `id="cursor"` / モデル ID はネイティブ / デフォルト `composer-2` | Cursor ドキュメントと一致、サブスク不要のモデルが既定 |
| 11 | ファイル構成 | モジュール分割（`cursor-provider/` 配下） | 責務分離・テスト容易性・LLM 編集効率 |

## 3. アーキテクチャ概要

```text
[OpenCode Runtime]
  │ ① 起動: PluginInput を渡してプラグイン初期化
  ▼
[CursorProviderPlugin (entry)]
  │ ② AuthHook 登録（cursor: api タイプ）
  │ ③ ProviderHook 登録（id="cursor"）
  ▼
  └─ models() コールバック発火
       │ ④ Cursor.models.list() → 失敗時は静的フォールバック
       │ ⑤ ModelV2 オブジェクト群を生成（doStream を含む）
       ▼
       Map<modelId, ModelV2> を OpenCode へ返却

[OpenCode 推論時]
  │ ⑥ ユーザーが cursor/composer-2 を選択
  │ ⑦ OpenCode が ModelV2.doStream({ prompt, ... }) を呼ぶ
  ▼
[StreamProxy]
  │ ⑧ Translator: messages → 履歴ハッシュ + last user msg
  │ ⑨ AgentPool.tryGet(hash) → ヒット時 reuse / ミス時 new Agent
  │ ⑩ agent.send(msg, { onDelta, onStep })
  │ ⑪ onDelta を ReadableStream<LanguageModelV2StreamPart> に変換
  │     ・TextDelta  → text-delta
  │     ・Thinking   → reasoning-delta
  │     ・ToolCall   → text-delta（"⚠️ Cursor attempted to use tool: X" 警告挿入）
  ▼
[OpenCode UI] (リアルタイム描画)
```

## 4. モジュール構成

| パス | 役割 |
|---|---|
| `.opencode/plugins/cursor-provider/index.ts` | エントリ。`Plugin` 関数本体。`AuthHook` / `ProviderHook` 構成、プロセス終了フック |
| `.opencode/plugins/cursor-provider/provider.ts` | `ProviderHook.models()` 実装。動的取得 + フォールバック |
| `.opencode/plugins/cursor-provider/auth.ts` | `AuthHook` 定義。`ctx.auth` と `process.env.CURSOR_API_KEY` から鍵解決 |
| `.opencode/plugins/cursor-provider/models.ts` | 静的フォールバックモデルリスト、`ModelV2` ファクトリ |
| `.opencode/plugins/cursor-provider/translator.ts` | OpenCode `messages` → 履歴ハッシュ + 整形済みプロンプト変換 |
| `.opencode/plugins/cursor-provider/agent-pool.ts` | LRU キャッシュ。`tryGet`, `put`, `rekey`, `closeAll` |
| `.opencode/plugins/cursor-provider/stream-proxy.ts` | `agent.send` → `ReadableStream<LanguageModelV2StreamPart>` 変換 |
| `.opencode/plugins/cursor-provider/logger.ts` | `client.app.log` 互換 `Logger`（既存実装をモジュール化して移植） |
| `.opencode/plugins/cursor-provider/errors.ts` | Cursor SDK エラー → OpenCode 用エラーマッピング、リトライ戦略 |

`package.json` の `main` および `exports` を `./.opencode/plugins/cursor-provider/index.ts` に更新する。

## 5. モジュール契約

### 5.1 `translator.ts`

```ts
type OpenCodePrompt = LanguageModelV2Prompt;  // [{role, content}, ...]

interface TranslatedRequest {
  prefixHash: string;          // 「最新ユーザー発言を除く履歴」の SHA-256
  latestUserMessage: string;   // プールヒット時の差分送信用
  fullPromptOnMiss: string;    // プールミス時の整形済み初回プロンプト
  nextHash: string;            // ターン完了後の新プールキー（最新を含む全履歴のハッシュ）
}

export function translate(prompt: OpenCodePrompt): TranslatedRequest;
```

- ハッシュは Node 標準 `crypto` の SHA-256。`role` と `content` をシリアライズ後にハッシュ化
- 整形は `<system>...</system>\n<user>...</user>\n<assistant>...</assistant>\n<user>最新</user>` 形式

### 5.2 `agent-pool.ts`

```ts
interface PooledAgent {
  agent: SDKAgent;       // @cursor/sdk の Agent
  lastUsedAt: number;
  modelId: string;
  apiKeyFingerprint: string;  // SHA-256 先頭 8 文字（識別用）
}

interface AgentPool {
  tryGet(hash: string, modelId: string, apiKey: string): PooledAgent | undefined;
  put(hash: string, agent: PooledAgent): Promise<void>;  // LRU 退避時 close を 5s タイムアウト
  rekey(oldHash: string, newHash: string): void;
  closeAll(): Promise<void>;
}
```

- 上限 8 件 LRU
- 内部キーは `${apiKeyFingerprint}:${modelId}:${prefixHash}`

### 5.3 `stream-proxy.ts`

```ts
interface StreamProxyInput {
  agent: SDKAgent;
  message: string;
  abortSignal?: AbortSignal;
}

export function createStream(input: StreamProxyInput): {
  stream: ReadableStream<LanguageModelV2StreamPart>;
  done: Promise<void>;
};
```

- 内部で `agent.send(msg, { onDelta, onStep })` を呼び、`onDelta` で `controller.enqueue`
- `TurnEndedUpdate` または `run.wait()` の解決で `controller.close()`

### 5.4 `provider.ts`

```ts
export function createProviderHook(deps: {
  resolveApiKey: (ctx: ProviderHookContext) => Promise<string | undefined>;
  log: Logger;
  pool: AgentPool;
}): ProviderHook;
```

- 内部で各モデルに対して `ModelV2` を生成
- `doStream` 実装は `translator.translate` → `pool.tryGet`/`Agent.create` → `stream-proxy.createStream` の合成

### 5.5 `auth.ts`

```ts
// 優先順位: ctx.auth > process.env.CURSOR_API_KEY
export function resolveApiKey(ctx: ProviderHookContext): Promise<string | undefined>;

// AuthHook 定義（opencode auth login cursor 用）
export const cursorAuthHook: AuthHook;
```

- `AuthHook.methods` には `type: "api"` のみ含める（OAuth はスコープ外）
- `prompts` に `key` 入力プロンプトを 1 つ定義

### 5.6 `logger.ts`

既存 `custom-tools.ts` の `Logger` ラッパー実装を流用。サービス名を `"cursor-provider"` に変更。

### 5.7 `errors.ts`

```ts
export interface RetryDecision {
  retry: boolean;
  delayMs: number;
  reason: string;
}

export function classifyError(err: unknown): RetryDecision;
export function logError(log: Logger, err: unknown, context: Record<string, unknown>): void;
```

## 6. データフロー

### 6.1 プールヒット（同じ会話の続き）

```text
1. OpenCode → ModelV2.doStream({ prompt: messages })
2. translator.translate(messages)
   → { prefixHash, latestUserMessage, nextHash }
3. agent-pool.tryGet(prefixHash, modelId, apiKey) → PooledAgent ヒット
4. stream-proxy.createStream({ agent, message: latestUserMessage })
5. onDelta 発火ごとに ReadableStream へ enqueue
6. TurnEnded で controller.close()
7. agent-pool.rekey(prefixHash, nextHash)
```

### 6.2 プールミス（新規会話 / 履歴分岐）

```text
1. OpenCode → ModelV2.doStream({ prompt: messages })
2. translator.translate(messages) → { fullPromptOnMiss, nextHash, ... }
3. agent-pool.tryGet(prefixHash) → undefined
4. Agent.create({ apiKey, model: { id }, local: { cwd } })
5. stream-proxy.createStream({ agent, message: fullPromptOnMiss })
6. ストリーム完了後 agent-pool.put(nextHash, { agent, ... })
   → LRU 容量超過時は最古を close（5s timeout）
```

### 6.3 起動時のモデル一覧解決

```text
1. OpenCode → ProviderHook.models(provider, ctx)
2. auth.resolveApiKey(ctx)
3. Cursor.models.list({ apiKey }) を 5s タイムアウトで実行
4-a. 成功 → SDKModel[] を ModelV2 化して返却
4-b. 失敗 → log.warn("...static fallback") → STATIC_FALLBACK_MODELS を返却
5. apiKey 未解決の場合 → log.warn → STATIC_FALLBACK_MODELS のみ返却
```

### 6.4 プロセス終了時のクリーンアップ

```text
1. プラグイン初期化時に process.on("beforeExit"/"SIGINT"/"SIGTERM") をフック
2. agent-pool.closeAll() を Promise.allSettled + 5s 全体タイムアウトで実行
3. 失敗は log.warn のみ（ブロックしない）
```

## 7. エラーハンドリング

### 7.1 Cursor SDK エラー → 動作マッピング

| Cursor 例外 | 検出箇所 | 動作 | ログレベル |
|---|---|---|---|
| `AuthenticationError` | `Agent.create` / `agent.send` | プールから除去 → re-throw。`models()` 内で発火した場合は静的フォールバックへ退避 | `error` |
| `ConfigurationError` | `Agent.create` / `agent.send` | re-throw | `error` |
| `RateLimitError` | `agent.send` | re-throw（リトライなし）。`retryAfterMs` があればログに記録 | `error` |
| `NetworkError` | 任意 | `isRetryable=true` の場合のみ 1 回だけ 500ms バックオフでリトライ。失敗時 re-throw | `warn`（リトライ）/ `error`（最終） |
| `IntegrationNotConnectedError` | 任意 | re-throw | `error` |
| `UnknownAgentError`（プール agent が消失） | `agent.send` | プールから除去 → 即時新規 Agent で 1 回再試行 | `warn` |
| `CursorSdkError` その他派生 | 任意 | re-throw | `error` |
| 予期せぬ例外 | 任意 | re-throw | `error` |

### 7.2 実行ステータス系（`run.wait()` 後）

| ステータス | 動作 |
|---|---|
| `finished` | stream に `finish` パート enqueue |
| `error` | error メタ情報をログ（メッセージ本文は length のみ）→ stream に error パート enqueue → `controller.error` |
| `cancelled` | `warn` ログ → stream に `finish(reason="abort")` enqueue |
| その他 | `error` ログ → stream に error パート enqueue |

### 7.3 キャンセレーション

- OpenCode が渡す `AbortSignal` を監視
- 発火時:
  1. onDelta ループから抜ける
  2. プール内の agent は **close せず保持**（reuse 可能性のため）
  3. `controller.close()`

### 7.4 Tool-call 警告挿入

- `ToolCallStartedUpdate` 受信時、stream に text-delta として以下を挿入:
  ```
  ⚠️ [cursor-provider] Cursor agent attempted to use tool: <toolName>. Pure LLM mode is in effect; the tool call is surfaced for visibility but not executed by OpenCode.
  ```
- 同時に `log.warn("cursor: unexpected tool-call in Pure LLM mode", { toolName })`

### 7.5 `chat.params` 警告

- プラグインライフサイクル中の初回検出時のみ `log.warn`。以降は黙殺
- フラグはモジュールスコープの boolean で管理

### 7.6 機微情報の非出力

- API キー: 一切ログに出さない。fingerprint（SHA-256 先頭 8 文字）のみ識別用に許可
- prompt / response 本文: `length` のみログ出力
- ハッシュ（プールキー）: 先頭 8 文字のみログ出力

### 7.7 ログレベル運用

- `debug`: ハッシュ計算結果、プールヒット／ミス
- `info`: agent 作成、prompt 送信開始、stream 完了、agent close
- `warn`: モデル一覧取得失敗、tool-call 警告、params 警告、ネットワークリトライ、close 失敗
- `error`: API キー欠落、SDK エラー、`run.status=error`

## 8. テスト戦略

### 8.1 フレームワーク

`vitest`（既存踏襲）。Devcontainer 内で `pnpm test` 実行。

### 8.2 単体テスト（モジュール毎）

| ファイル | 主要観点 |
|---|---|
| `tests/translator.test.ts` | 空履歴／履歴あり／連続 user message のハッシュ安定性、`prefixHash` と `nextHash` の分離、履歴分岐でハッシュ不一致、整形フォーマット、空 prompt や非対応ロールの拒否 |
| `tests/agent-pool.test.ts` | LRU 退避、`lastUsedAt` 更新、`rekey`、close 失敗時の warn、5s タイムアウト（fake timers）、apiKey 違いで別エントリ |
| `tests/stream-proxy.test.ts` | TextDelta → text-delta、Thinking → reasoning-delta、ToolCallStarted → 警告挿入 + warn、TurnEnded → finish、AbortSignal でクローズ、`run.status=error` で error パート |
| `tests/errors.test.ts` | 各 Cursor 例外型のマッピング、NetworkError リトライ 1 回上限、UnknownAgentError でプール除去 |
| `tests/auth.test.ts` | `ctx.auth` 優先、env フォールバック、両方欠落時の `undefined` |
| `tests/provider.test.ts` | `Cursor.models.list` 成功時の ModelV2 生成、失敗時の静的フォールバック、5s タイムアウト |
| `tests/models.test.ts` | 静的フォールバックリストのスキーマ検証 |
| `tests/logger.test.ts` | API キー／prompt 本文がログに含まれない（負のテスト）、レベル切替 |

### 8.3 モック戦略

- `@cursor/sdk` は `vi.mock` で完全モック化（実 API は呼ばない）
- `client.app.log` は in-memory ロガーモック（`logs.push(...)` で検証）
- Node 標準 `crypto` はそのまま使用

### 8.4 既存テストの扱い

- `tests/cursor-prompt.test.ts` → 削除
- `tests/schema.test.ts` → 削除（translator のスキーマテストへ吸収）

### 8.5 統合テスト

`tests/integration/provider-flow.test.ts`: モック `@cursor/sdk` を使い、初回呼出 → プールヒット → 退避 → 再ヒットのフルライフサイクルを 1 ケースで通す。

### 8.6 E2E

実 Cursor API を叩くテストは CI から除外。`pnpm test:e2e`（任意スクリプト）として手動実行用に置く。手順は本ドキュメント末尾の付録に記載。

### 8.7 CI

`.github/workflows/ci.yml`（既存）流用。`pnpm typecheck && pnpm test`。カバレッジ目標 80%（強制ゲートなし）。

## 9. リリース・移行

- バージョンを `0.2.0` に bump（破壊的変更）
- `README.md` に以下を反映:
  - 「v0.1.x の `cursor_prompt` ツールは削除されました」を明記
  - メイン LLM としての設定例（`opencode.jsonc` の `provider` セクション）
  - `opencode auth login cursor` の利用方法
- `SPEC.md` を本設計書ベースに刷新（または本書へのリンクに置換）
- `AGENTS.md` の参照先 SPEC を本書へ更新

## 10. 付録: 手動 E2E 手順（参考）

```bash
# 1. 実 Cursor API キーを設定
export CURSOR_API_KEY="<your-key>"

# 2. ローカルプラグインを参照する opencode.jsonc を用意
#    plugins: [["./.opencode/plugins/cursor-provider/index.ts", {}]]

# 3. opencode を起動し /provider cursor を選択
opencode

# 4. 簡単な質問でストリーミング応答を確認
> Hello, what model are you?

# 5. 連続 2 ターン目でプールヒット動作を確認（ログ debug 出力）
```
