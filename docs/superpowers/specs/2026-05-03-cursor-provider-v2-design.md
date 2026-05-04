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
  // hashMessages(filter(messages \ latestUserMessage)) — assistant/tool は除外
  prefixHash: string;
  // プールヒット時の差分送信用
  latestUserMessage: string;
  // プールミス時の整形済み初回プロンプト（assistant 応答も含めて全体を整形）
  fullPromptOnMiss: string;
  // hashMessages(filter(messages)) — ターン完了後の新プールキー
  nextHash: string;
}

export function translate(prompt: OpenCodePrompt): TranslatedRequest;
```

- ハッシュは Node 標準 `crypto` の SHA-256
- **ハッシュ対象は `role="system"` と `role="user"` のみ**（`assistant` / `tool` 等は除外）
  - 理由: OpenCode は `LanguageModelV2` 規約に従い毎ターン全履歴（assistant 応答含む）を渡すが、Cursor SDK の `Agent` は内部で会話状態を保持するため、プール再利用判定に assistant 応答を含めると「ターン 1 の `nextHash`」と「ターン 2 の `prefixHash`」が必ず不一致となり、プール最適化（質問 5・6）が機能不全に陥る。`system + user` 列のみをハッシュ対象とすることで「同じ会話の続きか」の判定が成立する
  - 副作用として、assistant 応答だけが異なる分岐（同じ user 入力で再生成）はプールヒットしてしまう。本設計ではこれを許容する（再生成意図ならユーザがチャット履歴を編集するなど明示的な変化が伴うため、user 列の差分で結局ミスになる想定）
- `latestUserMessage` は messages 配列末尾の `role="user"` メッセージから抽出。末尾が `user` でない場合（assistant 連鎖等）は `ConfigurationError` 相当の例外を投げる
- 整形（`fullPromptOnMiss`）は `<system>...</system>\n<user>...</user>\n<assistant>...</assistant>\n<user>最新</user>` 形式（assistant 応答も含めて Cursor へ初回コンテキストとして渡す）

> 想定動作チェーン:
> - ターン 1: messages = `[system, U1]` → `nextHash_1 = hash([system, U1])` → `pool.put(nextHash_1, agent)`
> - ターン 2: messages = `[system, U1, R1, U2]` → `prefixHash_2 = hash(filter([system, U1, R1])) = hash([system, U1]) = nextHash_1` ✓ ヒット
> - ターン 2 完了: `nextHash_2 = hash([system, U1, U2])` → `pool.rekey(fingerprint, modelId, prefixHash_2, nextHash_2)`

### 5.2 `agent-pool.ts`

```ts
interface PooledAgent {
  agent: SDKAgent;       // @cursor/sdk の Agent
  lastUsedAt: number;
  modelId: string;
  apiKeyFingerprint: string;  // SHA-256 先頭 16 文字（識別用）
}

interface AgentPool {
  tryGet(hash: string, modelId: string, apiKey: string): PooledAgent | undefined;
  put(hash: string, agent: PooledAgent): Promise<void>;  // LRU 退避時 close を 5s タイムアウト
  // (fingerprint, modelId, oldHash) で一意に識別したエントリのみを移動する。
  // 異なるユーザーが同一 prefixHash を持つケース（衝突）でも、他ユーザーの
  // エントリを巻き込まないために fingerprint と modelId は必須。
  rekey(fingerprint: string, modelId: string, oldHash: string, newHash: string): void;
  delete(hash: string, modelId: string, apiKey: string): Promise<void>;  // 該当エントリを除去 + agent.close() を 5s タイムアウト。未存在キーは no-op
  closeAll(): Promise<void>;
}
```

- 上限 8 件 LRU
- 内部キーは `${apiKeyFingerprint}:${modelId}:${prefixHash}`
- **prefixHash 単独のセカンダリインデックスは持たない**: 異なる API キーで同一 prefixHash が衝突する状況下で `rekey` が別ユーザーのエントリを移動してしまう不具合を防ぐため、識別はすべて複合キーで行う

### 5.3 `stream-proxy.ts`

```ts
interface StreamProxyInput {
  agent: SDKAgent;
  message: string;
  abortSignal?: AbortSignal;
  // pre-stream で `UnknownAgentError` を捕捉した際に呼ばれる新規 Agent 生成
  // コールバック。プールヒット由来でこのコールバックが定義されている場合のみ
  // 1 回だけ再試行する。
  // 戻り値の `message` は **再送信時に使用する文字列**（通常は translator の
  // `fullPromptOnMiss` 相当）。新規 agent には先行会話の履歴が無いため、
  // 元の `latestUserMessage` ではなく履歴を含む完全プロンプトを渡す必要がある。
  // pool.delete / Agent.create リトライ吸収は呼出側 (`runDoStream`) のクロージャ責務。
  recreateAgent?: () => Promise<{ agent: SDKAgent; message: string }>;
}

export type StreamFinishReason = "stop" | "abort" | "error";

// 異常終端時に呼出側へ伝播する分類タグ。`finishReason !== "stop"` のときに付与し、
// 主に `runDoStream` が pool 操作の継続性（rekey vs. delete）を判断するために用いる。
// `err.constructor.name` をそのまま採用するため Cursor SDK 側の例外型名と一致する。
export type StreamErrorType =
  | "UnknownAgentError"
  | "NetworkError"
  | "AuthenticationError"
  | "RateLimitError"
  | "ConfigurationError"
  | "IntegrationNotConnectedError"
  | "CursorSdkError"
  | "Error";

export function createStream(input: StreamProxyInput): {
  stream: ReadableStream<LanguageModelV2StreamPart>;
  done: Promise<{ finishReason: StreamFinishReason; errorType?: StreamErrorType }>;
};
```

- 内部で `agent.send(msg, { onDelta, onStep })` を呼び、`onDelta` で `controller.enqueue`
- **終端契約 (`done` の解決値)**: ストリームが終端した「理由」と「異常時の分類タグ」を `done` の解決値として呼び出し側に通知する。`finishReason` は最初に確定したものを採用する prefer-first 規則で、後続の異常系イベントが上書きしないようにガードする。`finishReason !== "stop"` のとき、catch 経路で捕捉した例外の `err.constructor.name` を `errorType` として併せて返却する（`run.wait()` の `status="error"` 等で例外が無いケースは省略可）。呼び出し側 (`provider.ts::runDoStream`) は `finishReason` で pool の rekey / delete を分岐し、`errorType` で `UnknownAgentError` のリトライ後始末（§6.1 参照）を判断する。
- **`cancel()` の責務**: `ReadableStream` の `cancel()` ハンドラは内部 `AbortController` を `abort()` し、IIFE の早期終了パスへ合流させる。`controller.close()` を `cancel()` 内で直接呼ばないのは、`cancel()` 経由では controller が既に終端遷移中で `close()` が `TypeError` を投げる可能性があるため。`cancel()` は `finishReason="abort"` を予約し、`done` は abort で解決する。
- **内部 AbortController の集約**: 外部 `abortSignal` と consumer の `cancel()` を共通の内部シグナルへ集約する。IIFE 側のリトライ・ループも内部シグナルを参照することで両経路で同じ早期終了挙動を保証する。SDK が将来 `agent.send({ signal })` をサポートした際は、内部シグナルをそのまま渡せる構造を維持する。
- **終端ガード**: 内部状態 `hasClosedStream: boolean` を保持。終端処理は以下のヘルパに統一する:
  ```ts
  function safeEnqueue(part: LanguageModelV2StreamPart): void {
    if (hasClosedStream) {
      log.debug("stream-proxy: enqueue after close ignored", { partType: part.type });
      return;
    }
    controller.enqueue(part);
  }
  function safeClose(): void {
    if (hasClosedStream) return;
    hasClosedStream = true;
    controller.close();
  }
  ```
- 一次終端は `TurnEndedUpdate`、二次終端は `run.wait()` 解決時の `RunResult.status` 分岐（§7.2 参照）。`hasClosedStream` ガードによりどちらが先に走っても安全
- イベント分岐（網羅的 switch、未知の型は `log.debug` で記録のみ・enqueue しない）:
  - `TextDeltaUpdate` → text-delta `safeEnqueue`
  - `ThinkingDeltaUpdate` → reasoning-delta `safeEnqueue`
  - `ToolCallStartedUpdate` → 警告 text-delta `safeEnqueue`（§7.4 参照、`toolCallId` 単位で 1 回のみ）
  - `PartialToolCallUpdate` / `ToolCallCompletedUpdate` → ドロップ
  - `TurnEndedUpdate` → finish パート `safeEnqueue` → `safeClose()`
- **リトライ境界の状態追跡**: 内部に `hasEmittedDelta: boolean` を保持し、最初の `controller.enqueue` 直前に `true` へ遷移。例外捕捉時は `errors.classifyError(err, { phase })` を呼び出す。`phase` の決定:
  - `agent.send` 呼出前 / 例外発生時点で `hasEmittedDelta=false` かつ `run.wait()` 未開始 → `"pre-stream"`
  - `hasEmittedDelta=true` → `"in-stream"`
  - `run.wait()` 解決中／解決後 → `"post-stream"`
  - （`"create"` は `provider.ts` 側で `Agent.create` を直接呼ぶ箇所が判定する）
- `classifyError` が `retry: true` を返した場合のみ §7.1 のリトライ処理へ進む。それ以外は即 re-throw → §7.2 の error ステータス相当として `safeEnqueue(error part)` → `safeClose()`
- **UnknownAgentError 専用リトライ**: `phase="pre-stream"` かつ `err.constructor.name === "UnknownAgentError"` かつ `recreateAgent` が定義済みのケースのみ、`recreateAgent()` を 1 回だけ呼び出して `{ agent, message }` を取得 → 取得した新 agent に対し `agent.send(message, { onDelta })` を再実行（`message` は新 agent に履歴が無いため `fullPromptOnMiss` 相当の完全プロンプトを呼出側が渡す）→ `run.wait()` の status を主経路と同じく分岐（`finished` / `cancelled` / その他）して `safeEnqueue` + `safeClose`。`recreateAgent` 内部の `Agent.create` リトライ（NetworkError 500ms バックオフ）は呼出側 (`runDoStream`) のクロージャ責務で、`stream-proxy` は単一試行として扱う。`recreateAgent()` または再 `agent.send` で例外が出た場合は `safeEnqueue(error part)` → `safeClose()` で終端し、`done` を `errorType="UnknownAgentError"` 付きで解決する

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
- **API キーの再解決**: `doStream` は内部で毎回 `resolveApiKey(ctx)` を再呼出する。`models()` 呼出時点の `apiKey` をクロージャに固定すると、`CURSOR_API_KEY` 差し替えや `opencode auth` での再認証が次回モデル一覧再取得まで反映されないため。`ctx` は `models()` 時点で確定するが、`resolveApiKey` 自体が env / auth ストアを毎回参照する想定で実装する

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
export type RetryPhase = "create" | "pre-stream" | "in-stream" | "post-stream";

export interface RetryDecision {
  retry: boolean;
  delayMs: number;
  reason: string;
}

// phase に応じてリトライ可否を判定（NetworkError は in-stream / post-stream で
// retry: false を返し、ストリーム重複を防ぐ）
export function classifyError(
  err: unknown,
  ctx: { phase: RetryPhase },
): RetryDecision;

export function logError(log: Logger, err: unknown, context: Record<string, unknown>): void;
```

`RetryPhase` のセマンティクス:

- `create`: `Agent.create` 呼出中（stream 未生成 → リトライ安全）
- `pre-stream`: `agent.send` 呼出後・`onDelta` 未発火（stream は生成されたが未配送 → リトライ安全）
- `in-stream`: `onDelta` が 1 回以上発火済み（リトライ不可、重複の原因）
- `post-stream`: `run.wait()` 解決中もしくは解決後（リトライ不可、結果は確定済み）

## 6. データフロー

### 6.1 プールヒット（同じ会話の続き）

```text
1. OpenCode → ModelV2.doStream({ prompt: messages })
2. translator.translate(messages)
   → { prefixHash, latestUserMessage, nextHash }
3. agent-pool.tryGet(prefixHash, modelId, apiKey) → PooledAgent ヒット
4. stream-proxy.createStream({ agent, message: latestUserMessage, recreateAgent })
   - `recreateAgent` は呼出側 (`runDoStream`) が注入するクロージャで、
     `pool.delete(prefixHash, modelId, apiKey) → Agent.create(...)` を実行し
     `{ agent: 新 agent, message: fullPromptOnMiss }` を返す（新 agent には
     先行会話の履歴が無いため、再送信時は完全プロンプトを使う）
5. onDelta 発火ごとに ReadableStream へ enqueue
6. TurnEnded で controller.close()
7. done が解決したら (finishReason, errorType) に応じて分岐:
   - finishReason="stop": agent-pool.rekey(fingerprint, modelId, prefixHash, nextHash)
     - 直前にストリーム内 UnknownAgentError リトライ（§7.1）が走った場合、
       現在の agent はプール未登録の新インスタンスなので追加で
       `pool.put(nextHash, ...)` を実行（rekey はスキップ）
   - finishReason="abort"|"error": agent-pool.delete(prefixHash, modelId, apiKey)
     （内部で agent.close を 5s タイムアウト付きで実行 / 異常 agent をプールに残さない）
```

### 6.2 プールミス（新規会話 / 履歴分岐）

```text
1. OpenCode → ModelV2.doStream({ prompt: messages })
2. translator.translate(messages) → { fullPromptOnMiss, nextHash, ... }
3. agent-pool.tryGet(prefixHash) → undefined
4. Agent.create({ apiKey, model: { id }, local: { cwd } })
   - 例外時は `classifyError(err, { phase: "create" })` を評価し
     `retry: true`（NetworkError 等）なら 500ms バックオフで 1 回再試行
   - 再試行も失敗した場合は呼出側へ throw（OpenCode 上位で扱う）
5. stream-proxy.createStream({ agent, message: fullPromptOnMiss })
   - プールミス経路では `recreateAgent` は注入しない（UnknownAgentError は
     `Agent.create` 直後の新規 agent では発生しない前提）
6. done が解決したら finishReason に応じて分岐:
6-a. (finishReason="stop") agent-pool.put(nextHash, { agent, ... })
       → LRU 容量超過時は最古を close（5s timeout）
6-b. (finishReason="abort"|"error") agent.close() を 5s タイムアウトで実行
       → プールには登録しない。次ターンは必ず §6.2 を新規再実行（§7.3 参照）
```

> **旧設計からの差分**: 以前は「キャンセル」と「正常完了」の 2 分岐で `abortSignal.aborted` を直接参照していたが、`status=error` / `status=cancelled`（abortSignal 未トリガ）/ `agent.send` 例外などの異常系経路で破損した agent が pool.put / pool.rekey を経由して次ターンに引き継がれる不具合があった。`createStream` の `done` 解決値に `finishReason` を含める契約に変更し、呼び出し側はそれを唯一の判定基準とする。

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
1. プラグイン初期化時に process.once("beforeExit"/"SIGINT"/"SIGTERM") をフック
   （once により再 raise 時の自己再帰呼び出しを防止）
2. agent-pool.closeAll() を Promise.allSettled + 5s 全体タイムアウトで実行
3. 失敗は log.warn のみ（ブロックしない）
4. シグナル経路 (SIGINT/SIGTERM) のみ、クリーンアップ完了後に
   process.kill(process.pid, signal) で同シグナルを再 raise し、
   他リスナー / Node デフォルト終了動作に制御を返す
   （beforeExit 経路では Node が自然終了するため不要）
```

> **背景**: Node.js では `SIGINT`/`SIGTERM` にリスナーを登録するとデフォルト終了動作が抑制されるため、明示的な終了処理を行わないとプロセスがハングし Ctrl+C が効かなくなる。`process.exit()` 直書きは OpenCode 本体や他プラグインのシグナルハンドラを奪うリスクがあるため、`process.kill(process.pid, signal)` で再 raise する方式を採用する。

## 7. エラーハンドリング

### 7.1 Cursor SDK エラー → 動作マッピング

| Cursor 例外 | 検出箇所 | 動作 | ログレベル |
|---|---|---|---|
| `AuthenticationError` | `Agent.create` / `agent.send` | プールから除去 → re-throw。`models()` 内で発火した場合は静的フォールバックへ退避 | `error` |
| `ConfigurationError` | `Agent.create` / `agent.send` | re-throw | `error` |
| `RateLimitError` | `agent.send` | re-throw（リトライなし）。`retryAfterMs` があればログに記録 | `error` |
| `NetworkError` | `Agent.create` 中（`runDoStream` 内）、または `agent.send` 呼出直後で **onDelta 未発火** の段階（`stream-proxy` 内）に限り | `isRetryable=true` の場合 1 回だけ 500ms バックオフでリトライ。`Agent.create` 段階のリトライは `runDoStream` が `classifyError(err, { phase: "create" })` で判定し直接実行する。`agent.send` 段階のリトライは `stream-proxy` が pre-stream phase で実行する。onDelta 発火後または `run.wait()` 解決中は re-throw（`agent.send` は one-shot で resume 不可のため、リトライすると先行 enqueue 済みチャンクとリトライ側のチャンクが重複しストリームが破損する）。失敗時 re-throw | `warn`（リトライ）/ `error`（最終 / リトライ不可で再スロー） |
| `IntegrationNotConnectedError` | 任意 | re-throw | `error` |
| `UnknownAgentError`（プール agent が消失） | `agent.send`（pre-stream） | `stream-proxy` が `recreateAgent` コールバック経由で 1 回だけ再試行する。`recreateAgent` は呼出側 (`runDoStream`) が注入するクロージャで、内部で `pool.delete(prefixHash, modelId, apiKey)` を実行してから新規 `Agent.create` を呼ぶ。再試行で取得した新 agent で `agent.send(latestUserMessage, { onDelta })` を実行し、`run.wait()` の status を主経路と同様に分岐する。再試行成功時は `done` を `finishReason="stop"` で解決し、`runDoStream` 側で **§6.2 ステップ 6-a と同等の `pool.put(nextHash, ...)` を実行**してプール最適化の連続性を維持する（rekey は `prefixHash` のエントリを既に削除しているのでスキップ）。再試行も失敗した場合は `errorType` 付きで `done` を解決し、上位で `agent.close` を実行 | `warn` |
| `CursorSdkError` その他派生 | 任意 | re-throw | `error` |
| 予期せぬ例外 | 任意 | re-throw | `error` |

### 7.2 実行ステータス系（`run.wait()` 後）

> **終端責務の整理**: 正常完了経路では `onDelta(TurnEndedUpdate)` が先行して `safeClose()` を呼ぶため、本表の `finished` 行はガードに弾かれて no-op となる（`hasClosedStream=true` で early return、§5.3 参照）。本表は主に `error` / `cancelled` / その他のステータスで `TurnEndedUpdate` が発火しないケースの動作を規定する。すべての enqueue / close 操作は `safeEnqueue` / `safeClose` ヘルパ経由で行い、二重終端による `TypeError` を物理的に防ぐ。

| ステータス | 動作 |
|---|---|
| `finished` | 通常はガードで no-op（`TurnEndedUpdate` が先行終端済み）。万一 `TurnEndedUpdate` が来ずに `finished` で解決した場合のみ、`finish` パート `safeEnqueue` → `safeClose()` |
| `error` | error メタ情報をログ（メッセージ本文は length のみ）→ `error` パート `safeEnqueue` → `safeClose()`（**`controller.error()` は呼ばない**: WHATWG Streams の `ResetQueue` で直前 enqueue が破棄されエラー情報が失われるため、`error` パートをデータとして配送し切る方式を採用） |
| `cancelled` | `warn` ログ → `finish(reason="abort")` パート `safeEnqueue` → `safeClose()` |
| その他 | `error` ログ → `error` パート `safeEnqueue` → `safeClose()`（`error` 行と同方針） |

### 7.3 キャンセレーション

キャンセルの発生源は 2 系統あり、`stream-proxy` は両者を内部 `AbortController` に集約して同一経路で扱う:

- **外部 `AbortSignal`**: OpenCode が `doStream` に渡す `args.abortSignal`。`addEventListener("abort", ...)` で監視。
- **`ReadableStream.cancel()`**: consumer (OpenCode 本体や下流 reader) がストリームを破棄した場合。`cancel()` ハンドラで内部 `AbortController.abort()` を発火させ、`finishReason="abort"` を予約する。`controller.close()` は呼ばない（§5.3 参照）。

検出後の挙動:

- **起動前 abort のショートサーキット**: `stream-proxy` 起動時点で内部シグナルが `aborted=true` の場合は `agent.send` を呼び出さず、`finish(abort)` パートを 1 度だけ enqueue して即 close する
- **リトライ境界での abort 確認**: `pre-stream` のバックオフ待機後、2 回目の `agent.send` を呼ぶ前に内部シグナル `aborted` を再確認し、true の場合はリトライをスキップして `finish(abort)` で終端する
- **リトライ後の status 検査**: pre-stream の NetworkError リトライ／UnknownAgentError リトライのいずれの経路でも、再実行した `run.wait()` の `status` を主経路（§7.2）と同じく `finished` / `cancelled` / `error` / その他で分岐し、`safeEnqueue` で finish / error パートを発行する。リトライ経路で status を破棄して即 `safeClose()` する実装は禁止（consumer がエラー通知を受け取れずストリームが無言終了するため）
- 発火時:
  1. onDelta ループから抜ける
  2. **出自に応じて agent をクローズ**（二重 close 防止のため経路ごとに責務を分離）:
     - **プールヒット経由**: `pool.delete(prefixHash, modelId, apiKey)`
       （§5.2 仕様により内部で `agent.close()` を 5s タイムアウト付きで実行）
     - **プールミス経由**: `agent.close()` を 5s タイムアウトで直接実行
       （プール未登録のため pool 操作不要）
  3. `safeClose()` で `controller.close()`
- **呼び出し側 (`runDoStream`) の責務**: `done` の解決値の `finishReason` を見て上記 close 処理を実行する。`finishReason !== "stop"` の場合は `pool.put` / `pool.rekey` を行わない（§6.1 / §6.2）。

> **SDK signal 引き渡しに関する注記**: 理想的には `agent.send(message, { signal })` のように
> AbortSignal を SDK 側へ伝播させ、走行中のリクエストを直接中断できることが望ましい。
> しかし `@cursor/sdk` 現行版は公式に `signal` オプションを公開していないため、
> 本設計では「ダウンストリームを即時クローズ + agent を破棄」する間接アプローチを採用する。
> SDK が `signal` 対応した時点で `agent.send` 呼出に渡し、本ショートサーキット相当の処理を
> SDK 側に委譲する形へ刷新する。

> **設計判断**: キャンセル後の agent 再利用は行わない。Cursor SDK は `agent.send(message)` 呼出時点で内部履歴に message を記録するため、キャンセル後に再利用すると次ターンの `latestUserMessage` が SDK 側で二重記録され、会話コンテキストが汚染される。状態汚染回避を `Agent.create` コスト（数秒）節約より優先し、確実な破棄を選択する。次ターンは必ず §6.2 のプールミス経路を新規実行する。

### 7.4 Tool-call 関連イベントの扱い

`@cursor/sdk` の `InteractionUpdate` には以下 3 種のツールコール関連イベントが存在する:

| イベント型 | 処理 |
|---|---|
| `ToolCallStartedUpdate` | stream に text-delta として警告メッセージを **1 回のみ** 挿入し、`log.warn` を出力。同 ToolCall（`toolCallId` 等で識別）に対する警告は重複させない |
| `PartialToolCallUpdate` | **無視（ドロップ）**。引数 JSON 断片が text-delta に流出するのを防ぐ。`log.debug` のみ任意で記録 |
| `ToolCallCompletedUpdate` | **無視（ドロップ）**。完了通知も警告対象外。`log.debug` のみ任意で記録 |

警告メッセージ本文:

```text
⚠️ [cursor-provider] Cursor agent attempted to use tool: <toolName>. Pure LLM mode is in effect; the tool call is surfaced for visibility but not executed by OpenCode.
```

同時にログ: `log.warn("cursor: unexpected tool-call in Pure LLM mode", { toolName, toolCallId })`

> 設計意図: Pure LLM モード（質問 4-A）では Cursor がツールを実行しないことを期待するが、実装上 Cursor SDK がツール呼び出しを発火する余地は残る。Started のみを警告対象とすることで「ツール呼び出しが発生した事実」を運用者に通知しつつ、Delta／Completed の派生イベントが UI に漏出するノイズを排除する。

### 7.5 `chat.params` 警告

- プラグインライフサイクル中の初回検出時のみ `log.warn`。以降は黙殺
- **フラグは `createProviderHook` のクロージャスコープで管理**（プロバイダーフック単位）。モジュールスコープに置くとテスト間で状態が共有され、ある testcase で発火したフラグが後続 testcase で再発火不能になり独立性が崩れるため。テストでは `createProviderHook` を再生成するだけでフラグを初期化できる

### 7.6 機微情報の非出力

- API キー: 一切ログに出さない。fingerprint（SHA-256 先頭 16 文字）のみ識別用に許可
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
| `tests/translator.test.ts` | 空履歴／履歴あり／連続 user message のハッシュ安定性、`prefixHash` と `nextHash` の分離、履歴分岐でハッシュ不一致、整形フォーマット、空 prompt や非対応ロールの拒否、**assistant メッセージを含む履歴で連続 2 ターンが同一プールキーで結ばれる（`turn1.nextHash === turn2.prefixHash`）**、**assistant 応答内容が変わっても user 列が同じならハッシュは変わらない（assistant 列がフィルタされている確認）**、末尾が user でない messages 配列を拒否 |
| `tests/agent-pool.test.ts` | LRU 退避、`lastUsedAt` 更新、`rekey`、close 失敗時の warn、5s タイムアウト（fake timers）、apiKey 違いで別エントリ、**キャンセル経路で `agent.close()` が 5s タイムアウト付きで呼ばれ、プールには登録されないこと**、**`delete` で該当エントリ除去 + `agent.close()` が 5s タイムアウト付きで呼ばれる、未存在キーへの `delete` が no-op となる**、**異なる fingerprint で同じ prefixHash を put した状態で一方のみを `rekey` しても他方が巻き込まれない（ハッシュ衝突回帰）** |
| `tests/stream-proxy.test.ts` | TextDelta → text-delta、Thinking → reasoning-delta、ToolCallStarted → 警告挿入 + warn（同 `toolCallId` で 1 回のみ）、`PartialToolCallUpdate` / `ToolCallCompletedUpdate` がドロップされ text-delta に流出しない、TurnEnded → finish、AbortSignal でクローズ、`run.status=error` で error パート enqueue + `controller.close()`（`controller.error` を呼ばない）、未知イベントが debug ログのみ、**1 chunk 配送後 (`hasEmittedDelta=true`) の NetworkError でリトライが発火せず error パートが流れる（重複防止）**、`hasEmittedDelta=false` 時の NetworkError ではリトライが 1 回発火してから配送が継続する、**`TurnEndedUpdate` 後に `run.wait()` が `finished` で解決しても `controller.enqueue` / `close` が二度呼ばれない（`hasClosedStream` ガード動作）**、**`safeEnqueue` が close 後の呼出を debug ログのみで握り潰す**、**起動時点で `abortSignal.aborted=true` の場合 `agent.send` を呼ばずに finish(abort) を 1 回だけ enqueue する**、**pre-stream リトライのバックオフ中に abort された場合、2 回目の `agent.send` をスキップして finish(abort) で終端する**、**pre-stream NetworkError リトライ後の `run.wait()` が `status="error"` で解決した場合、主経路と同じく `error` パートが enqueue されてから close する（リトライ経路の status 分岐回帰）**、**`UnknownAgentError` 発生時、`recreateAgent` が定義されていれば 1 回呼び出され、`recreateAgent` が返した `message`（`fullPromptOnMiss` 相当）を新 agent に送って再試行し、成功すれば `done` が `{finishReason:"stop"}` で解決する（`latestUserMessage` ではなく完全プロンプトが送られる回帰）**、**`UnknownAgentError` 発生時、`recreateAgent` が失敗すると `done` が `{finishReason:"error", errorType:"UnknownAgentError"}` で解決する**、**`UnknownAgentError` 発生時に `recreateAgent` 未注入なら再試行せず error パートを流す** |
| `tests/errors.test.ts` | 各 Cursor 例外型のマッピング、`classifyError` の phase 別判定（NetworkError × `create` / `pre-stream` で `retry: true`、`in-stream` / `post-stream` で `retry: false`）、NetworkError リトライ 1 回上限、UnknownAgentError でプール除去 + リトライ後 `pool.put(nextHash)` 実行 |
| `tests/auth.test.ts` | `ctx.auth` 優先、env フォールバック、両方欠落時の `undefined` |
| `tests/provider.test.ts` | `Cursor.models.list` 成功時の ModelV2 生成、失敗時の静的フォールバック、5s タイムアウト、**`doStream` 呼出のたびに `resolveApiKey(ctx)` が再評価され、API キーローテーション後も `models()` 再取得なしで新しい鍵が使われる**、**`chat.params` 警告がフック単位で 1 度のみ、`createProviderHook` を再生成すれば再度発火する（テスト間独立性）**、**プールミス経路で `Agent.create` が NetworkError 時に 500ms バックオフで 1 回再試行される**、**プールヒット経路で `UnknownAgentError` リトライが成功した場合、`pool.delete(prefixHash)` 呼出後に新 agent が `pool.put(nextHash, ...)` で登録される（rekey は呼ばれない）** |
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

`tests/integration/provider-flow.test.ts`: モック `@cursor/sdk` を使い、以下のフルライフサイクルをケース化:

1. 初回呼出（プールミス → `Agent.create` → put(nextHash)）
2. 連続ターンでプールヒット（差分送信 → `rekey`）
3. 別会話を 8 件投入して LRU 退避を発火、最古 agent が `close()` される
4. 退避された会話を再開 → 再ミス → 再生成
5. キャンセル経路: ストリーム途中で `AbortSignal` 発火 → `agent.close()`（5s timeout）→ プール未登録 → 次ターンは §6.2 プールミス経路で新規 `Agent.create`（**前ターンと別 agent インスタンスが生成されることを検証**）

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
