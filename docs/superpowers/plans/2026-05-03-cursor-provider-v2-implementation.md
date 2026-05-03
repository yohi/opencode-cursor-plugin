# Cursor Provider V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** OpenCode の `cursor_prompt` カスタムツールを廃止し、`@cursor/sdk` を OpenCode のメイン LLM プロバイダーとして利用できる `ProviderHook` を実装する（v0.2.0 破壊的リリース）。

**Architecture:** `.opencode/plugins/cursor-provider/` 配下を 9 モジュール（logger, errors, translator, agent-pool, auth, models, stream-proxy, provider, index）に分割し、責務分離と TDD を両立する。履歴ハッシュベースの Agent プーリング（LRU 上限 8）で会話継続を高速化し、ミス時はフルプロンプト fallback で堅牢性を確保。`onDelta` を `ReadableStream<LanguageModelV2StreamPart>` に変換しストリーミング応答を中継する。

**Tech Stack:** TypeScript (ES2022, strict), `@opencode-ai/plugin` ^1.14.30, `@cursor/sdk` ^1.0.10, vitest 1.6, pnpm 9.12.0, Node 20。テスト・型検査は **Devcontainer 内で必ず実行**（Dockerfile: `mcr.microsoft.com/devcontainers/typescript-node`）。

**設計書参照:** [`docs/superpowers/specs/2026-05-03-cursor-provider-v2-design.md`](../specs/2026-05-03-cursor-provider-v2-design.md)

---

## Phase 0: 初期セットアップ（スキップ）

CI/CD（`.github/workflows/ci.yml`、`master` ブランチ・`ubuntu-slim` ランナー）および Devcontainer（`.devcontainer/Dockerfile`、`devcontainer.json`）は **既存** のため、Phase 0 構築タスクはスキップする。

> **検証コマンド（Devcontainer 内で実行）:**
> ```bash
> cat .github/workflows/ci.yml | grep -E "branches:|runs-on:"
> # 期待: branches: [master] / runs-on: ubuntu-slim
> ls .devcontainer/
> # 期待: Dockerfile / devcontainer.json
> ```

---

## Phase 1: 純粋ユーティリティ層（logger / errors / translator）

副作用のない 3 モジュールを TDD で実装する。Cursor SDK や OpenCode runtime に依存しないため、すべての Task は Phase 1 base から並行に派生可能。

**Phase ブランチ:** `feature/phase1_pure-utilities__base`（`master` から派生）
**Phase Draft PR ターゲット:** `master`

### Task 1.1: `logger.ts` モジュール抽出

**派生元:** `feature/phase1_pure-utilities__base`（独立タスク：他 Task と差分が交差しない）

**Files:**
- Create: `.opencode/plugins/cursor-provider/logger.ts`
- Create: `tests/logger.test.ts`

**コンテキスト:** 既存 `custom-tools.ts:29-55` の `Logger` ラッパーを抽出し、サービス名を `"cursor-provider"` に変更する。`client.app.log` が `info`/`warn`/`error`/`debug` メソッド形式と body オブジェクト形式の双方をサポートするため、両形式に対応する。秘匿情報（API キー本文・prompt 本文）はログに含めない。

- [ ] **Step 1: Devcontainer 起動と現状確認**

```bash
# ホスト側からコンテナへ入る（VS Code "Reopen in Container" もしくは CLI）
# 以降のすべてのコマンドはコンテナ内で実行する
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
```
Expected: 既存テストがすべて PASS。

- [ ] **Step 2: ブランチ作成**

```bash
git checkout master
git pull origin master
git checkout -b feature/phase1_pure-utilities__base
git push -u origin feature/phase1_pure-utilities__base
git checkout -b feature/phase1-task1_logger
```

- [ ] **Step 3: 失敗するテスト作成 (`tests/logger.test.ts`)**

```ts
import { describe, it, expect, vi } from "vitest";
import { createLogger } from "../.opencode/plugins/cursor-provider/logger";

describe("createLogger", () => {
  it("メソッド形式の rawLog (info/warn/error/debug) に委譲する", () => {
    const rawLog = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    const log = createLogger(rawLog);

    log.info("hello", { foo: 1 });
    expect(rawLog.info).toHaveBeenCalledWith("hello", { foo: 1 });
  });

  it("関数形式の rawLog には body 形式で service=cursor-provider をセットする", () => {
    const rawLog = vi.fn();
    const log = createLogger(rawLog);

    log.warn("oops", { code: 42 });
    expect(rawLog).toHaveBeenCalledWith({
      body: {
        service: "cursor-provider",
        level: "warn",
        message: "oops",
        extra: { code: 42 },
      },
    });
  });

  it("API キー本文・prompt 本文をログに含めない（呼び出し側責務）", () => {
    const rawLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const log = createLogger(rawLog);
    log.info("agent created", { apiKeyFingerprint: "abcd1234", promptLength: 256 });
    const call = rawLog.info.mock.calls[0]?.[1] ?? {};
    expect(JSON.stringify(call)).not.toMatch(/sk-[a-zA-Z0-9_-]{8,}/);
  });
});
```

- [ ] **Step 4: テストが失敗することを確認**

```bash
pnpm test -- tests/logger.test.ts
```
Expected: モジュール解決エラーで FAIL。

- [ ] **Step 5: 実装作成 (`.opencode/plugins/cursor-provider/logger.ts`)**

```ts
export interface Logger {
  info(message: string, extra?: Record<string, unknown>): void;
  warn(message: string, extra?: Record<string, unknown>): void;
  error(message: string, extra?: Record<string, unknown>): void;
  debug(message: string, extra?: Record<string, unknown>): void;
}

type Level = "info" | "warn" | "error" | "debug";

interface RawLogMethods {
  info?: (m: string, e?: Record<string, unknown>) => void;
  warn?: (m: string, e?: Record<string, unknown>) => void;
  error?: (m: string, e?: Record<string, unknown>) => void;
  debug?: (m: string, e?: Record<string, unknown>) => void;
}

type RawLogFn = (payload: {
  body: { service: string; level: Level; message: string; extra?: Record<string, unknown> };
}) => void;

export function createLogger(rawLog: RawLogMethods | RawLogFn, service = "cursor-provider"): Logger {
  const dispatch = (level: Level, message: string, extra?: Record<string, unknown>) => {
    const methods = rawLog as RawLogMethods;
    const fn = methods[level];
    if (typeof fn === "function") {
      fn(message, extra);
      return;
    }
    if (typeof rawLog === "function") {
      (rawLog as RawLogFn)({ body: { service, level, message, extra } });
    }
  };

  return {
    info: (m, e) => dispatch("info", m, e),
    warn: (m, e) => dispatch("warn", m, e),
    error: (m, e) => dispatch("error", m, e),
    debug: (m, e) => dispatch("debug", m, e),
  };
}
```

- [ ] **Step 6: テストが通ることを確認**

```bash
pnpm test -- tests/logger.test.ts
pnpm typecheck
```
Expected: PASS / 型エラーなし。

- [ ] **Step 7: コミット**

```bash
git add .opencode/plugins/cursor-provider/logger.ts tests/logger.test.ts
git commit -m "feat(cursor-provider): Logger モジュールを cursor-provider 名で抽出"
```

- [ ] **Step 8: Draft PR 作成（→ Phase 1 base）**

```bash
git push -u origin feature/phase1-task1_logger
gh pr create --draft --base feature/phase1_pure-utilities__base \
  --title "feat(cursor-provider): logger モジュール抽出" \
  --body "$(cat <<'EOF'
## Summary
- 既存 `custom-tools.ts` の Logger ラッパーを `.opencode/plugins/cursor-provider/logger.ts` に抽出
- service 名を `cursor-provider` に変更
- メソッド形式 / 関数形式の双方の rawLog をサポート

## Test plan
- [ ] `pnpm typecheck` 成功
- [ ] `pnpm test -- tests/logger.test.ts` 全 PASS
EOF
)"
```

---

### Task 1.2: `errors.ts` エラーマッピング・リトライ判定

**派生元:** `feature/phase1_pure-utilities__base`（独立タスク：他 Task と物理的に交差しない）

**Files:**
- Create: `.opencode/plugins/cursor-provider/errors.ts`
- Create: `tests/errors.test.ts`

**コンテキスト:** 設計書 §5.7 / §7.1 の通り、`@cursor/sdk` の例外型を `RetryPhase` に基づき分類する。`NetworkError` は `create` / `pre-stream` のみリトライ可（500ms バックオフ × 1 回）、`in-stream` / `post-stream` ではストリーム重複防止のため `retry: false`。`UnknownAgentError` は呼び出し側でプール除去 + 1 回再試行。

- [ ] **Step 1: ブランチ作成**

```bash
git checkout feature/phase1_pure-utilities__base
git checkout -b feature/phase1-task2_errors
```

- [ ] **Step 2: 失敗するテスト作成 (`tests/errors.test.ts`)**

```ts
import { describe, it, expect, vi } from "vitest";
import {
  AuthenticationError,
  ConfigurationError,
  RateLimitError,
  NetworkError,
  IntegrationNotConnectedError,
  UnknownAgentError,
  CursorSdkError,
} from "@cursor/sdk";
import { classifyError, logError } from "../.opencode/plugins/cursor-provider/errors";

describe("classifyError", () => {
  it("AuthenticationError は全 phase で retry: false", () => {
    const err = new AuthenticationError("bad key");
    for (const phase of ["create", "pre-stream", "in-stream", "post-stream"] as const) {
      expect(classifyError(err, { phase }).retry).toBe(false);
    }
  });

  it("NetworkError は create / pre-stream で retry:true (delay 500ms)", () => {
    const err = new NetworkError("disconnect");
    (err as any).isRetryable = true;
    expect(classifyError(err, { phase: "create" })).toMatchObject({ retry: true, delayMs: 500 });
    expect(classifyError(err, { phase: "pre-stream" })).toMatchObject({ retry: true, delayMs: 500 });
  });

  it("NetworkError は in-stream / post-stream では retry: false（ストリーム重複防止）", () => {
    const err = new NetworkError("flap");
    (err as any).isRetryable = true;
    expect(classifyError(err, { phase: "in-stream" }).retry).toBe(false);
    expect(classifyError(err, { phase: "post-stream" }).retry).toBe(false);
  });

  it("RateLimitError / ConfigurationError / IntegrationNotConnectedError は retry: false", () => {
    expect(classifyError(new RateLimitError("rl"), { phase: "create" }).retry).toBe(false);
    expect(classifyError(new ConfigurationError("cfg"), { phase: "pre-stream" }).retry).toBe(false);
    expect(classifyError(new IntegrationNotConnectedError("noconn"), { phase: "create" }).retry).toBe(false);
  });

  it("UnknownAgentError は in-stream を含む全 phase で retry: false（呼び出し側で別経路リトライ）", () => {
    expect(classifyError(new UnknownAgentError("gone"), { phase: "in-stream" }).retry).toBe(false);
  });

  it("予期せぬ例外は retry: false", () => {
    expect(classifyError(new Error("boom"), { phase: "create" }).retry).toBe(false);
  });
});

describe("logError", () => {
  it("API キー文字列・prompt 本文をログに出さず、length と type のみ記録", () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    logError(log, new AuthenticationError("sk-very-secret-12345"), { phase: "create" });
    const args = log.error.mock.calls[0]?.[1] ?? {};
    expect(JSON.stringify(args)).not.toMatch(/sk-very-secret/);
    expect(args.errorType).toBe("AuthenticationError");
  });
});
```

- [ ] **Step 3: テスト失敗確認**

```bash
pnpm test -- tests/errors.test.ts
```
Expected: モジュール未実装で FAIL。

- [ ] **Step 4: 実装作成 (`.opencode/plugins/cursor-provider/errors.ts`)**

```ts
import {
  AuthenticationError,
  ConfigurationError,
  RateLimitError,
  NetworkError,
  IntegrationNotConnectedError,
  UnknownAgentError,
  CursorSdkError,
} from "@cursor/sdk";
import type { Logger } from "./logger.js";

export type RetryPhase = "create" | "pre-stream" | "in-stream" | "post-stream";

export interface RetryDecision {
  retry: boolean;
  delayMs: number;
  reason: string;
}

const NO_RETRY = (reason: string): RetryDecision => ({ retry: false, delayMs: 0, reason });

export function classifyError(err: unknown, ctx: { phase: RetryPhase }): RetryDecision {
  if (err instanceof NetworkError) {
    const retryable = (err as { isRetryable?: boolean }).isRetryable ?? false;
    if (!retryable) return NO_RETRY("NetworkError not retryable");
    if (ctx.phase === "create" || ctx.phase === "pre-stream") {
      return { retry: true, delayMs: 500, reason: "NetworkError safe to retry pre-delivery" };
    }
    return NO_RETRY("NetworkError after delivery would duplicate stream");
  }
  if (err instanceof AuthenticationError) return NO_RETRY("AuthenticationError");
  if (err instanceof ConfigurationError) return NO_RETRY("ConfigurationError");
  if (err instanceof RateLimitError) return NO_RETRY("RateLimitError");
  if (err instanceof IntegrationNotConnectedError) return NO_RETRY("IntegrationNotConnectedError");
  if (err instanceof UnknownAgentError) return NO_RETRY("UnknownAgentError handled by caller");
  if (err instanceof CursorSdkError) return NO_RETRY("CursorSdkError");
  return NO_RETRY("unknown");
}

export function logError(
  log: Logger,
  err: unknown,
  context: Record<string, unknown>,
): void {
  const errorType = err instanceof Error ? err.constructor.name : typeof err;
  const messageLength = err instanceof Error ? err.message.length : 0;
  log.error("cursor-provider: error captured", {
    ...context,
    errorType,
    messageLength,
  });
}
```

- [ ] **Step 5: テスト通過確認**

```bash
pnpm test -- tests/errors.test.ts
pnpm typecheck
```
Expected: PASS。

- [ ] **Step 6: コミット**

```bash
git add .opencode/plugins/cursor-provider/errors.ts tests/errors.test.ts
git commit -m "feat(cursor-provider): SDK 例外を RetryPhase で分類する errors モジュール追加"
```

- [ ] **Step 7: Draft PR 作成（→ Phase 1 base）**

```bash
git push -u origin feature/phase1-task2_errors
gh pr create --draft --base feature/phase1_pure-utilities__base \
  --title "feat(cursor-provider): errors モジュール (classifyError / logError)" \
  --body "## Summary
- Cursor SDK 例外を RetryPhase ベースで分類
- NetworkError は create/pre-stream のみ retry:true (500ms)
- 機微情報（API キー本文）をログ出力しない logError 実装

## Test plan
- [ ] tests/errors.test.ts 全 PASS"
```

---

### Task 1.3: `translator.ts` 履歴ハッシュ + プロンプト整形

**派生元:** `feature/phase1_pure-utilities__base`（独立タスク：純粋関数で他 Task に依存しない）

**Files:**
- Create: `.opencode/plugins/cursor-provider/translator.ts`
- Create: `tests/translator.test.ts`

**コンテキスト:** 設計書 §5.1 を実装。`messages` 配列のうち **`role="system"` と `role="user"` のみ** を SHA-256 でハッシュ化し（assistant/tool は除外）、`prefixHash`（最新 user 直前まで）と `nextHash`（全 user/system）を返す。末尾が `user` でない場合は例外。

- [ ] **Step 1: ブランチ作成**

```bash
git checkout feature/phase1_pure-utilities__base
git checkout -b feature/phase1-task3_translator
```

- [ ] **Step 2: 失敗するテスト作成 (`tests/translator.test.ts`)**

```ts
import { describe, it, expect } from "vitest";
import { translate } from "../.opencode/plugins/cursor-provider/translator";
import type { LanguageModelV2Prompt } from "@opencode-ai/plugin";

const sys = (text: string) => ({ role: "system" as const, content: text });
const usr = (text: string) => ({ role: "user" as const, content: [{ type: "text" as const, text }] });
const asst = (text: string) => ({ role: "assistant" as const, content: [{ type: "text" as const, text }] });

describe("translate", () => {
  it("単一 user メッセージで prefixHash === hash([system]) を返す", () => {
    const prompt: LanguageModelV2Prompt = [sys("you are helpful"), usr("hi")];
    const r = translate(prompt);
    expect(r.latestUserMessage).toBe("hi");
    expect(r.prefixHash).toMatch(/^[a-f0-9]{64}$/);
    expect(r.nextHash).not.toBe(r.prefixHash);
  });

  it("ターン1 nextHash と ターン2 prefixHash が一致する（assistant 列フィルタ）", () => {
    const turn1: LanguageModelV2Prompt = [sys("S"), usr("U1")];
    const turn2: LanguageModelV2Prompt = [sys("S"), usr("U1"), asst("R1"), usr("U2")];
    const r1 = translate(turn1);
    const r2 = translate(turn2);
    expect(r2.prefixHash).toBe(r1.nextHash);
  });

  it("assistant 応答内容のみ違っても prefixHash/nextHash は同じ", () => {
    const a: LanguageModelV2Prompt = [sys("S"), usr("U1"), asst("RA"), usr("U2")];
    const b: LanguageModelV2Prompt = [sys("S"), usr("U1"), asst("RB"), usr("U2")];
    expect(translate(a).prefixHash).toBe(translate(b).prefixHash);
    expect(translate(a).nextHash).toBe(translate(b).nextHash);
  });

  it("user 履歴が分岐すると nextHash が異なる", () => {
    const a: LanguageModelV2Prompt = [sys("S"), usr("U1"), usr("U2")];
    const b: LanguageModelV2Prompt = [sys("S"), usr("U1"), usr("U2-alt")];
    expect(translate(a).nextHash).not.toBe(translate(b).nextHash);
  });

  it("末尾が user でない messages を例外で拒否", () => {
    const bad: LanguageModelV2Prompt = [sys("S"), usr("U1"), asst("R1")];
    expect(() => translate(bad)).toThrow(/last message must be user/i);
  });

  it("空 prompt を例外で拒否", () => {
    expect(() => translate([])).toThrow();
  });

  it("fullPromptOnMiss は <system>/<user>/<assistant> タグで整形され末尾は最新 user", () => {
    const p: LanguageModelV2Prompt = [sys("S"), usr("U1"), asst("R1"), usr("U2")];
    const r = translate(p);
    expect(r.fullPromptOnMiss).toMatch(/<system>S<\/system>/);
    expect(r.fullPromptOnMiss).toMatch(/<user>U1<\/user>/);
    expect(r.fullPromptOnMiss).toMatch(/<assistant>R1<\/assistant>/);
    expect(r.fullPromptOnMiss.trim().endsWith("<user>U2</user>")).toBe(true);
  });
});
```

- [ ] **Step 3: テスト失敗確認**

```bash
pnpm test -- tests/translator.test.ts
```
Expected: FAIL（モジュール未定義）。

- [ ] **Step 4: 実装作成 (`.opencode/plugins/cursor-provider/translator.ts`)**

```ts
import { createHash } from "node:crypto";
import type { LanguageModelV2Prompt } from "@opencode-ai/plugin";

export interface TranslatedRequest {
  prefixHash: string;
  latestUserMessage: string;
  fullPromptOnMiss: string;
  nextHash: string;
}

type Msg = LanguageModelV2Prompt[number];

function extractText(m: Msg): string {
  if (typeof m.content === "string") return m.content;
  return m.content
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("");
}

function hashMessages(messages: Msg[]): string {
  const h = createHash("sha256");
  for (const m of messages) {
    if (m.role !== "system" && m.role !== "user") continue;
    h.update(`${m.role}\u0000${extractText(m)}\u0001`);
  }
  return h.digest("hex");
}

export function translate(prompt: LanguageModelV2Prompt): TranslatedRequest {
  if (prompt.length === 0) throw new Error("translate: prompt is empty");
  const last = prompt[prompt.length - 1];
  if (!last || last.role !== "user") {
    throw new Error("translate: last message must be user");
  }
  const latestUserMessage = extractText(last);
  const beforeLastUser = prompt.slice(0, -1);

  const prefixHash = hashMessages(beforeLastUser);
  const nextHash = hashMessages(prompt);

  const fullPromptOnMiss = prompt
    .map((m) => `<${m.role}>${extractText(m)}</${m.role}>`)
    .join("\n");

  return { prefixHash, latestUserMessage, fullPromptOnMiss, nextHash };
}
```

- [ ] **Step 5: テスト通過確認**

```bash
pnpm test -- tests/translator.test.ts
pnpm typecheck
```
Expected: PASS。

- [ ] **Step 6: コミット**

```bash
git add .opencode/plugins/cursor-provider/translator.ts tests/translator.test.ts
git commit -m "feat(cursor-provider): translator (履歴ハッシュ + prompt 整形) を追加"
```

- [ ] **Step 7: Draft PR 作成（→ Phase 1 base）**

```bash
git push -u origin feature/phase1-task3_translator
gh pr create --draft --base feature/phase1_pure-utilities__base \
  --title "feat(cursor-provider): translator モジュール" \
  --body "## Summary
- system + user のみを SHA-256 でハッシュ化（assistant/tool 除外）
- prefixHash / nextHash / fullPromptOnMiss を返却
- 末尾が user でない場合は例外

## Test plan
- [ ] tests/translator.test.ts 全 PASS"
```

---

### Phase 1 完了: Phase Draft PR 作成

- [ ] **Step 1: Phase 1 内 PR を順次マージ** (Task 1.1 → 1.2 → 1.3 を `feature/phase1_pure-utilities__base` にマージ)

- [ ] **Step 2: Phase 1 → master の Draft PR を作成**

```bash
git checkout feature/phase1_pure-utilities__base
gh pr create --draft --base master \
  --title "feat(cursor-provider): Phase 1 純粋ユーティリティ層 (logger/errors/translator)" \
  --body "## Summary
- Cursor Provider V2 のための純粋ユーティリティ 3 モジュールを追加
- logger / errors / translator
- 既存 cursor_prompt 機能には未介入（Phase 3 で削除）

## Test plan
- [ ] pnpm typecheck 成功
- [ ] pnpm test 全 PASS（既存テスト含む）

詳細: docs/superpowers/specs/2026-05-03-cursor-provider-v2-design.md §5.1 / §5.6 / §5.7"
```

> **マージ条件:** CI 全 PASS + コードレビュー後、`master` にマージ。マージ完了まで Phase 2 に進まない。

---

## Phase 2: ステート / 設定層（agent-pool / auth / models fallback）

Phase 1 のユーティリティ群を利用するが、各 Task は互いに参照しないため Phase 2 base から並行派生可能。

**Phase ブランチ:** `feature/phase2_state-layer__base`（Phase 1 マージ後の `master` から派生）
**Phase Draft PR ターゲット:** `master`

### Task 2.1: `agent-pool.ts` LRU キャッシュ実装

**派生元:** `feature/phase2_state-layer__base`（独立タスク）

**Files:**
- Create: `.opencode/plugins/cursor-provider/agent-cleanup.ts`（agent dispose の共有ユーティリティ）
- Create: `.opencode/plugins/cursor-provider/agent-pool.ts`
- Create: `tests/agent-cleanup.test.ts`
- Create: `tests/agent-pool.test.ts`

**コンテキスト:** 設計書 §5.2 / §6.1〜6.4 を実装。LRU 上限 8 件、内部キーは `${apiKeyFingerprint}:${modelId}:${prefixHash}`。`put` で容量超過時 / 同一キー上書き時に displaced エントリを `disposeAgentSafely()`（5s タイムアウト）で確実に閉じる。`delete` で個別エントリ除去 + dispose。`closeAll` でプロセス終了時の一括クリーンアップ。dispose 関数は Task 3.2 (`provider.ts`) のエラー経路でも再利用するため、`agent-cleanup.ts` として別モジュール化する。

- [ ] **Step 1: ブランチ作成**

```bash
git checkout master && git pull
git checkout -b feature/phase2_state-layer__base
git push -u origin feature/phase2_state-layer__base
git checkout -b feature/phase2-task1_agent-pool
```

- [ ] **Step 2-a: 失敗するテスト作成 (`tests/agent-cleanup.test.ts`)**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { disposeAgentSafely } from "../.opencode/plugins/cursor-provider/agent-cleanup";
import { createLogger } from "../.opencode/plugins/cursor-provider/logger";

const log = createLogger({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() });

describe("disposeAgentSafely", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("正常系: agent[Symbol.asyncDispose]() を呼び await する", async () => {
    const agent = { [Symbol.asyncDispose]: vi.fn().mockResolvedValue(undefined) } as any;
    await disposeAgentSafely(agent, log);
    expect(agent[Symbol.asyncDispose]).toHaveBeenCalledTimes(1);
  });

  it("dispose が 5s 超でハングしてもタイムアウトで戻る (resolves)", async () => {
    const agent = { [Symbol.asyncDispose]: vi.fn(() => new Promise<void>(() => {})) } as any;
    const p = disposeAgentSafely(agent, log);
    vi.advanceTimersByTime(5_000);
    await expect(p).resolves.toBeUndefined();
    // タイムアウト時は warn が出ているべき
    expect(log.warn).toHaveBeenCalled();
  });

  it("dispose が reject しても rethrow せず warn ログのみ", async () => {
    const agent = { [Symbol.asyncDispose]: vi.fn().mockRejectedValue(new TypeError("boom")) } as any;
    await expect(disposeAgentSafely(agent, log)).resolves.toBeUndefined();
    expect(log.warn).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2-b: 失敗するテスト作成 (`tests/agent-pool.test.ts`)**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createAgentPool,
  fingerprintApiKey,
  type PooledAgent,
} from "../.opencode/plugins/cursor-provider/agent-pool";
import { createLogger } from "../.opencode/plugins/cursor-provider/logger";

const log = createLogger({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() });

// makeAgent は呼出側が指定した apiKey からフィンガープリントを再算出するため、
// テスト側でも `tryGet` / `delete` に同じ apiKey を渡す必要がある。
// 内部では複合キー `${fingerprint}:${modelId}:${hash}` で識別され、`tryGet` 側は
// `fingerprintApiKey(apiKey)` を再計算してエントリを引くため、テストの
// `apiKeyFingerprint` も `fingerprintApiKey(apiKey)` で揃える。
// `disposeAgentSafely` (agent-cleanup.ts) は `agent[Symbol.asyncDispose]()` の
// みを呼ぶため、mock も同名キーで spy を持たせる。pool / doStream のすべての
// cleanup 経路がこの関数経由なので、テスト assertion は `[Symbol.asyncDispose]`
// で統一する。`close` は SDK 仕様上の必須メンバなので型互換のために残しておく
// （現実装からは呼ばれないが、将来 close 直接検証テストが増えた場合の備え）。
const makeAgent = (apiKey = "key-original") => ({
  agent: {
    [Symbol.asyncDispose]: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
  } as any,
  lastUsedAt: Date.now(),
  modelId: "composer-2",
  apiKeyFingerprint: fingerprintApiKey(apiKey),
});

describe("AgentPool", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("tryGet ヒット時に lastUsedAt が更新される", () => {
    const pool = createAgentPool({ log, capacity: 8 });
    const apiKey = "key-original";
    const a = makeAgent(apiKey);
    pool.put("h1", a);
    vi.advanceTimersByTime(1000);
    const got = pool.tryGet("h1", a.modelId, apiKey);
    expect(got).toBeDefined();
  });

  it("LRU 容量超過時、最古エントリを asyncDispose する", async () => {
    const pool = createAgentPool({ log, capacity: 2 });
    const a1 = makeAgent();
    const a2 = makeAgent();
    const a3 = makeAgent();
    await pool.put("h1", a1);
    await pool.put("h2", a2);
    await pool.put("h3", a3);
    expect(a1.agent[Symbol.asyncDispose]).toHaveBeenCalled();
  });

  it("同一複合キーへの再 put: 旧 entry の agent を確実に dispose する", async () => {
    // 並行 miss で同じ (fingerprint, modelId, nextHash) に対して 2 回 put される
    // ケースの回帰テスト。旧実装は `map.set` が silent に上書きするだけで displaced
    // agent を leak していた。pool.put は同一キーの旧 agent を dispose してから
    // 新 agent を入れること。
    const pool = createAgentPool({ log, capacity: 8 });
    const apiKey = "k";
    const a = makeAgent(apiKey);
    const b = makeAgent(apiKey); // 同 apiKey/modelId → 同一複合キー
    await pool.put("h1", a);
    await pool.put("h1", b);
    expect(a.agent[Symbol.asyncDispose]).toHaveBeenCalledTimes(1);
    expect(b.agent[Symbol.asyncDispose]).not.toHaveBeenCalled();
    // 取得すると新 entry (b) が返る
    expect(pool.tryGet("h1", a.modelId, apiKey)?.agent).toBe(b.agent);
  });

  it("同一複合キーへの再 put で同一 agent インスタンスは dispose しない（自己 dispose 防止）", async () => {
    // displace ロジックが `displaced.agent === entry.agent` を判定せず無条件に
    // dispose すると、lastUsedAt 更新等の意図で同一 agent を put し直したケースで
    // 動作中の agent を閉じてしまう。識別ガードの回帰テスト。
    const pool = createAgentPool({ log, capacity: 8 });
    const apiKey = "k";
    const a = makeAgent(apiKey);
    await pool.put("h1", a);
    await pool.put("h1", a); // 同一インスタンスを再 put
    expect(a.agent[Symbol.asyncDispose]).not.toHaveBeenCalled();
  });

  it("agent[Symbol.asyncDispose] が 5s でタイムアウトしても put は完了する", async () => {
    const pool = createAgentPool({ log, capacity: 1 });
    const stuck = makeAgent();
    // SDK 仕様上 dispose は Promise<void> を返すので、ハング再現も同じ async シグネチャで作る。
    stuck.agent[Symbol.asyncDispose] = vi.fn(() => new Promise<void>(() => {}));
    await pool.put("h1", stuck);
    const p = pool.put("h2", makeAgent());
    vi.advanceTimersByTime(5_000);
    await expect(p).resolves.toBeUndefined();
  });

  it("rekey で旧キーが無効化、新キーで取れる", () => {
    const pool = createAgentPool({ log, capacity: 8 });
    const apiKey = "key-original";
    const a = makeAgent(apiKey);
    pool.put("old", a);
    pool.rekey(a.apiKeyFingerprint, a.modelId, "old", "new");
    expect(pool.tryGet("old", a.modelId, apiKey)).toBeUndefined();
    expect(pool.tryGet("new", a.modelId, apiKey)).toBeDefined();
  });

  it("rekey: 別 fingerprint の同一 prefixHash エントリは巻き込まれない", () => {
    // ハッシュ衝突回帰テスト: 異なる fingerprint で同じ prefixHash を put した状態で
    // 一方を rekey しても、もう一方は元の prefixHash で残り続ける。
    const pool = createAgentPool({ log, capacity: 8 });
    const apiKeyA = "user-a";
    const apiKeyB = "user-b";
    const a = makeAgent(apiKeyA);
    const b = makeAgent(apiKeyB);
    pool.put("shared", a);
    pool.put("shared", b);

    pool.rekey(a.apiKeyFingerprint, a.modelId, "shared", "next");

    expect(pool.tryGet("next", a.modelId, apiKeyA)).toBeDefined();
    expect(pool.tryGet("shared", a.modelId, apiKeyA)).toBeUndefined();
    // B 側は影響を受けない
    expect(pool.tryGet("shared", b.modelId, apiKeyB)).toBeDefined();
    expect(pool.tryGet("next", b.modelId, apiKeyB)).toBeUndefined();
  });

  it("delete で該当エントリ除去 + agent[Symbol.asyncDispose] を 5s タイムアウト付きで実行", async () => {
    const pool = createAgentPool({ log, capacity: 8 });
    const apiKey = "k";
    const a = makeAgent(apiKey);
    await pool.put("h1", a);
    await pool.delete("h1", a.modelId, apiKey);
    expect(a.agent[Symbol.asyncDispose]).toHaveBeenCalled();
    expect(pool.tryGet("h1", a.modelId, apiKey)).toBeUndefined();
  });

  it("delete: 未存在キーは no-op", async () => {
    const pool = createAgentPool({ log, capacity: 8 });
    await expect(pool.delete("missing", "m", "k")).resolves.toBeUndefined();
  });

  it("apiKey が異なれば別エントリとして扱う", () => {
    const pool = createAgentPool({ log, capacity: 8 });
    const apiKeyA = "key-a";
    const apiKeyB = "key-b";
    const a = makeAgent(apiKeyA);
    pool.put("h1", a);
    const b = makeAgent(apiKeyB);
    pool.put("h1", b);
    expect(pool.tryGet("h1", a.modelId, apiKeyA)).toBeDefined();
    expect(pool.tryGet("h1", b.modelId, apiKeyB)).toBeDefined();
    // 識別は複合キーで行うので A の apiKey で B の prefixHash は引けない（同 hash でも別エントリ）
    expect(pool.tryGet("h1", a.modelId, apiKeyA)?.apiKeyFingerprint).toBe(a.apiKeyFingerprint);
    expect(pool.tryGet("h1", b.modelId, apiKeyB)?.apiKeyFingerprint).toBe(b.apiKeyFingerprint);
  });

  it("closeAll で全エントリの agent[Symbol.asyncDispose] を呼ぶ", async () => {
    const pool = createAgentPool({ log, capacity: 8 });
    const a1 = makeAgent();
    const a2 = makeAgent();
    await pool.put("h1", a1);
    await pool.put("h2", a2);
    await pool.closeAll();
    expect(a1.agent[Symbol.asyncDispose]).toHaveBeenCalled();
    expect(a2.agent[Symbol.asyncDispose]).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: テスト失敗確認**

```bash
pnpm test -- tests/agent-pool.test.ts
```
Expected: FAIL。

- [ ] **Step 4-a: 実装作成 (`.opencode/plugins/cursor-provider/agent-cleanup.ts`)**

```ts
import type { Agent as SDKAgent } from "@cursor/sdk";
import type { Logger } from "./logger.js";

export const DISPOSE_TIMEOUT_MS = 5_000;

// SDK 仕様 (`@cursor/sdk` の `SDKAgent`):
//   - `close(): void`                           ← 同期。Promise を返さないため timeout と race できない。
//   - `[Symbol.asyncDispose](): Promise<void>`  ← 非同期 cleanup。ハング対策の race 対象はこちら。
//
// すべての agent cleanup 経路（pool eviction / pool delete / pool closeAll /
// pool 同一キー displace / doStream エラー経路）はこの関数を経由する。これにより:
//   1) ハング保護（5s タイムアウト）が一様に適用される
//   2) SDK の close 仕様変更時の修正点が 1 箇所
//   3) sync `close()` を使わず、必ず async `Symbol.asyncDispose` を使うポリシーを集約
export async function disposeAgentSafely(agent: SDKAgent, log: Logger): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), DISPOSE_TIMEOUT_MS);
  });
  try {
    const disposed = agent[Symbol.asyncDispose]().then(() => "ok" as const);
    const result = await Promise.race([disposed, timeoutPromise]);
    if (result === "timeout") {
      log.warn("cursor-provider: agent dispose timed out", {
        timeoutMs: DISPOSE_TIMEOUT_MS,
      });
    }
  } catch (err) {
    log.warn("cursor-provider: agent dispose failed", {
      errorType: (err as Error).constructor.name,
    });
  } finally {
    // race の勝敗に関わらずタイマーを解放（解放しないと event loop が残る）。
    if (timer) clearTimeout(timer);
  }
}
```

- [ ] **Step 4-b: 実装作成 (`.opencode/plugins/cursor-provider/agent-pool.ts`)**

```ts
import { createHash } from "node:crypto";
import type { Agent as SDKAgent } from "@cursor/sdk";
import type { Logger } from "./logger.js";
import { disposeAgentSafely } from "./agent-cleanup.js";

export interface PooledAgent {
  agent: SDKAgent;
  lastUsedAt: number;
  modelId: string;
  apiKeyFingerprint: string;
}

export interface AgentPool {
  tryGet(hash: string, modelId: string, apiKey: string): PooledAgent | undefined;
  // 同一複合キー (`fingerprint:modelId:hash`) に既存 entry が存在し、かつ
  // それが新 entry とは異なる agent インスタンスである場合、旧 agent を
  // `disposeAgentSafely` で確実に閉じてから新 entry を入れる。
  put(hash: string, agent: PooledAgent): Promise<void>;
  // rekey は (fingerprint, modelId, oldHash) で一意に識別したエントリのみを移動する。
  // 異なるユーザーが同一 prefixHash を持つケース（ハッシュ衝突）でも、他ユーザーの
  // エントリを巻き込まないために fingerprint と modelId は必須。
  rekey(fingerprint: string, modelId: string, oldHash: string, newHash: string): void;
  delete(hash: string, modelId: string, apiKey: string): Promise<void>;
  closeAll(): Promise<void>;
}

export function fingerprintApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex").slice(0, 8);
}

function poolKey(fingerprint: string, modelId: string, hash: string): string {
  return `${fingerprint}:${modelId}:${hash}`;
}

export function createAgentPool(deps: { log: Logger; capacity: number }): AgentPool {
  const { log, capacity } = deps;
  // 内部ストアはフルキー（fingerprint:modelId:prefixHash）で一意。
  // 旧実装の `hashToKey` は prefixHash 単独をキーにしていたため、異なる
  // fingerprint で同一 prefixHash を put すると後勝ちで上書きされ、rekey が
  // 別ユーザーの Agent を移動してしまう不具合があった。複合キーのみで管理する。
  const map = new Map<string, PooledAgent>();

  const evictIfNeeded = async () => {
    while (map.size > capacity) {
      const oldest = [...map.entries()].sort(
        (a, b) => a[1].lastUsedAt - b[1].lastUsedAt,
      )[0];
      if (!oldest) break;
      const [k, entry] = oldest;
      map.delete(k);
      log.info("cursor-provider: pool eviction", {
        modelId: entry.modelId,
        apiKeyFingerprint: entry.apiKeyFingerprint,
      });
      await disposeAgentSafely(entry.agent, log);
    }
  };

  return {
    tryGet(hash, modelId, apiKey) {
      const fp = fingerprintApiKey(apiKey);
      const k = poolKey(fp, modelId, hash);
      const entry = map.get(k);
      if (!entry) return undefined;
      entry.lastUsedAt = Date.now();
      return entry;
    },
    async put(hash, entry) {
      const k = poolKey(entry.apiKeyFingerprint, entry.modelId, hash);
      // 同一複合キーへの再 put 時に旧 agent を leak させない。
      // 並行 miss で 2 リクエストが同じ (fingerprint, modelId, nextHash) に
      // put すると、`map.set` の silent 上書きで先発 agent が pool から外れた
      // まま参照を失う。外で使われていない agent が残ると SDK 内部リソース
      // (long-poll 接続等) が解放されず、leak になる。
      // ただし `displaced.agent === entry.agent` の場合（lastUsedAt 更新目的の
      // 同一インスタンス再 put など）は dispose してはならない。
      const displaced = map.get(k);
      map.set(k, entry);
      if (displaced && displaced.agent !== entry.agent) {
        log.info("cursor-provider: pool displaced same-key entry", {
          modelId: entry.modelId,
          apiKeyFingerprint: entry.apiKeyFingerprint,
        });
        await disposeAgentSafely(displaced.agent, log);
      }
      await evictIfNeeded();
    },
    rekey(fingerprint, modelId, oldHash, newHash) {
      const oldKey = poolKey(fingerprint, modelId, oldHash);
      const entry = map.get(oldKey);
      if (!entry) return;
      const newKey = poolKey(fingerprint, modelId, newHash);
      map.delete(oldKey);
      map.set(newKey, entry);
    },
    async delete(hash, modelId, apiKey) {
      const fp = fingerprintApiKey(apiKey);
      const k = poolKey(fp, modelId, hash);
      const entry = map.get(k);
      if (!entry) return;
      map.delete(k);
      await disposeAgentSafely(entry.agent, log);
    },
    async closeAll() {
      const entries = [...map.values()];
      map.clear();
      await Promise.allSettled(entries.map((e) => disposeAgentSafely(e.agent, log)));
    },
  };
}
```

- [ ] **Step 5: テスト通過確認**

```bash
pnpm test -- tests/agent-cleanup.test.ts tests/agent-pool.test.ts
pnpm typecheck
```
Expected: PASS。

- [ ] **Step 6: コミット + Draft PR (→ Phase 2 base)**

```bash
git add \
  .opencode/plugins/cursor-provider/agent-cleanup.ts \
  .opencode/plugins/cursor-provider/agent-pool.ts \
  tests/agent-cleanup.test.ts \
  tests/agent-pool.test.ts
git commit -m "feat(cursor-provider): agent-cleanup ユーティリティ + LRU AgentPool"
git push -u origin feature/phase2-task1_agent-pool
gh pr create --draft --base feature/phase2_state-layer__base \
  --title "feat(cursor-provider): agent-cleanup + agent-pool (LRU + dispose timeout)" \
  --body "## Summary
- 共有 dispose ユーティリティ (5s timeout) を agent-cleanup.ts へ集約
- LRU 容量 8、apiKey fingerprint 識別、同一キー displace 時に旧 agent dispose
- delete / rekey / closeAll サポート

## Test plan
- [ ] tests/agent-cleanup.test.ts 全 PASS
- [ ] tests/agent-pool.test.ts 全 PASS（同一キー再 put / 自己 dispose 防止 含む）"
```

---

### Task 2.2: `auth.ts` API キー解決と AuthHook

**派生元:** `feature/phase2_state-layer__base`（独立タスク）

**Files:**
- Create: `.opencode/plugins/cursor-provider/auth.ts`
- Create: `tests/auth.test.ts`

**コンテキスト:** 設計書 §5.5 / §6.3。優先順位は `ctx.auth` > `process.env.CURSOR_API_KEY`。`AuthHook.methods` に `type: "api"` のみ含め（OAuth はスコープ外）、`prompts` に key 入力を 1 つ定義。

- [ ] **Step 1: ブランチ作成**

```bash
git checkout feature/phase2_state-layer__base
git checkout -b feature/phase2-task2_auth
```

- [ ] **Step 2: 失敗するテスト作成 (`tests/auth.test.ts`)**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveApiKey, cursorAuthHook } from "../.opencode/plugins/cursor-provider/auth";

describe("resolveApiKey", () => {
  const ORIG = process.env.CURSOR_API_KEY;
  beforeEach(() => { delete process.env.CURSOR_API_KEY; });
  afterEach(() => { if (ORIG) process.env.CURSOR_API_KEY = ORIG; else delete process.env.CURSOR_API_KEY; });

  it("ctx.auth に api キーがあれば最優先で返す", async () => {
    process.env.CURSOR_API_KEY = "from-env";
    const ctx: any = { auth: { get: async () => ({ type: "api", key: "from-ctx" }) } };
    expect(await resolveApiKey(ctx)).toBe("from-ctx");
  });

  it("ctx.auth が無ければ env をフォールバック", async () => {
    process.env.CURSOR_API_KEY = "from-env";
    const ctx: any = { auth: { get: async () => undefined } };
    expect(await resolveApiKey(ctx)).toBe("from-env");
  });

  it("両方欠落で undefined", async () => {
    const ctx: any = { auth: { get: async () => undefined } };
    expect(await resolveApiKey(ctx)).toBeUndefined();
  });

  it("空白のみのキーは undefined 扱い", async () => {
    const ctx: any = { auth: { get: async () => ({ type: "api", key: "   " }) } };
    expect(await resolveApiKey(ctx)).toBeUndefined();
  });
});

describe("cursorAuthHook", () => {
  it("methods に api タイプを含み、prompts は key 1 件", () => {
    expect(cursorAuthHook.methods.some((m: any) => m.type === "api")).toBe(true);
    const apiMethod = cursorAuthHook.methods.find((m: any) => m.type === "api") as any;
    expect(apiMethod.prompts).toHaveLength(1);
    expect(apiMethod.prompts[0].name).toBe("key");
  });
});
```

- [ ] **Step 3: テスト失敗確認**

```bash
pnpm test -- tests/auth.test.ts
```
Expected: FAIL。

- [ ] **Step 4: 実装作成 (`.opencode/plugins/cursor-provider/auth.ts`)**

```ts
import type { AuthHook, ProviderHookContext } from "@opencode-ai/plugin";

export async function resolveApiKey(ctx: ProviderHookContext): Promise<string | undefined> {
  try {
    const fromCtx = await ctx.auth?.get?.("cursor");
    if (fromCtx && (fromCtx as any).type === "api") {
      const k = ((fromCtx as any).key as string | undefined)?.trim();
      if (k) return k;
    }
  } catch {
    // fallthrough to env
  }
  const env = process.env.CURSOR_API_KEY?.trim();
  return env && env.length > 0 ? env : undefined;
}

export const cursorAuthHook: AuthHook = {
  provider: "cursor",
  methods: [
    {
      type: "api",
      label: "Cursor API key",
      prompts: [
        { name: "key", label: "Cursor API key", type: "password" },
      ],
    },
  ],
};
```

- [ ] **Step 5: テスト通過 + 型確認**

```bash
pnpm test -- tests/auth.test.ts
pnpm typecheck
```
Expected: PASS。型不整合があれば `@opencode-ai/plugin` 型定義に合わせ調整。

- [ ] **Step 6: コミット + Draft PR (→ Phase 2 base)**

```bash
git add .opencode/plugins/cursor-provider/auth.ts tests/auth.test.ts
git commit -m "feat(cursor-provider): auth モジュール (ctx.auth 優先 + env fallback)"
git push -u origin feature/phase2-task2_auth
gh pr create --draft --base feature/phase2_state-layer__base \
  --title "feat(cursor-provider): auth モジュール" \
  --body "## Summary
- ctx.auth (api type) > process.env.CURSOR_API_KEY 優先順位
- AuthHook 定義 (api type のみ、OAuth はスコープ外)

## Test plan
- [ ] tests/auth.test.ts 全 PASS"
```

---

### Task 2.3: `models.ts` 静的フォールバック + ModelV2 ファクトリ骨組み

**派生元:** `feature/phase2_state-layer__base`（独立タスク）

**Files:**
- Create: `.opencode/plugins/cursor-provider/models.ts`
- Create: `tests/models.test.ts`

**コンテキスト:** 設計書 §6.3 の 4-b / 5。`Cursor.models.list()` が失敗・apiKey 未解決時に返す静的フォールバックリスト（`composer-2`, `claude-3-7-sonnet`, `gpt-4o` 等）の最小スキーマを定義。`ModelV2` ファクトリは `doStream` を後続 Task で注入するため、本タスクでは「メタ情報生成のみ」を実装。

- [ ] **Step 1: ブランチ作成**

```bash
git checkout feature/phase2_state-layer__base
git checkout -b feature/phase2-task3_models
```

- [ ] **Step 2: 失敗するテスト作成 (`tests/models.test.ts`)**

```ts
import { describe, it, expect } from "vitest";
import { STATIC_FALLBACK_MODELS, makeModelMeta, DEFAULT_MODEL_ID } from "../.opencode/plugins/cursor-provider/models";

describe("STATIC_FALLBACK_MODELS", () => {
  it("composer-2 を含み、すべて id/name/contextWindow フィールドを持つ", () => {
    expect(STATIC_FALLBACK_MODELS.some((m) => m.id === "composer-2")).toBe(true);
    for (const m of STATIC_FALLBACK_MODELS) {
      expect(typeof m.id).toBe("string");
      expect(typeof m.name).toBe("string");
      expect(typeof m.contextWindow).toBe("number");
      expect(m.contextWindow).toBeGreaterThan(0);
    }
  });

  it("DEFAULT_MODEL_ID は composer-2", () => {
    expect(DEFAULT_MODEL_ID).toBe("composer-2");
  });
});

describe("makeModelMeta", () => {
  it("specificationVersion='v2' / provider='cursor' を返す", () => {
    const meta = makeModelMeta({ id: "composer-2", name: "Composer 2", contextWindow: 200000 });
    expect(meta.specificationVersion).toBe("v2");
    expect(meta.provider).toBe("cursor");
    expect(meta.modelId).toBe("composer-2");
  });
});
```

- [ ] **Step 3: テスト失敗確認 → 実装**

```bash
pnpm test -- tests/models.test.ts
```

- [ ] **Step 4: 実装作成 (`.opencode/plugins/cursor-provider/models.ts`)**

```ts
export interface FallbackModel {
  id: string;
  name: string;
  contextWindow: number;
}

export const DEFAULT_MODEL_ID = "composer-2";

export const STATIC_FALLBACK_MODELS: ReadonlyArray<FallbackModel> = [
  { id: "composer-2", name: "Composer 2", contextWindow: 200_000 },
  { id: "claude-3-7-sonnet", name: "Claude 3.7 Sonnet (via Cursor)", contextWindow: 200_000 },
  { id: "gpt-4o", name: "GPT-4o (via Cursor)", contextWindow: 128_000 },
];

export interface ModelMeta {
  specificationVersion: "v2";
  provider: "cursor";
  modelId: string;
  name: string;
  contextWindow: number;
}

export function makeModelMeta(model: FallbackModel): ModelMeta {
  return {
    specificationVersion: "v2",
    provider: "cursor",
    modelId: model.id,
    name: model.name,
    contextWindow: model.contextWindow,
  };
}
```

- [ ] **Step 5: テスト通過 + コミット + Draft PR**

```bash
pnpm test -- tests/models.test.ts
pnpm typecheck
git add .opencode/plugins/cursor-provider/models.ts tests/models.test.ts
git commit -m "feat(cursor-provider): 静的フォールバックモデル + ModelMeta ファクトリ"
git push -u origin feature/phase2-task3_models
gh pr create --draft --base feature/phase2_state-layer__base \
  --title "feat(cursor-provider): models 静的フォールバック" \
  --body "## Summary
- composer-2 / claude-3-7-sonnet / gpt-4o の静的メタ
- DEFAULT_MODEL_ID = composer-2

## Test plan
- [ ] tests/models.test.ts 全 PASS"
```

---

### Phase 2 完了: Phase Draft PR

- [ ] **Step 1: Phase 2 内 PR を順次マージ**

- [ ] **Step 2: Phase 2 → master の Draft PR**

```bash
git checkout feature/phase2_state-layer__base
gh pr create --draft --base master \
  --title "feat(cursor-provider): Phase 2 ステート/設定層 (agent-pool/auth/models)" \
  --body "## Summary
- LRU AgentPool / API キー解決 / 静的フォールバックモデル

## Test plan
- [ ] pnpm typecheck 成功
- [ ] pnpm test 全 PASS"
```

> **マージ条件:** CI 全 PASS、Phase 1 マージ済み。マージ完了まで Phase 3 に進まない。

---

## Phase 3: ストリーミング / プロバイダー統合 + 旧ツール削除

Phase 1 / 2 のモジュール群を統合し、`ProviderHook` および Plugin エントリポイントを完成させる。**Task 3.2 と 3.3 は前 Task の物理依存があるため数珠つなぎ派生**。

**Phase ブランチ:** `feature/phase3_provider-integration__base`（Phase 2 マージ後の `master` から派生）
**Phase Draft PR ターゲット:** `master`

### Task 3.1: `stream-proxy.ts` ストリーム変換

**派生元:** `feature/phase3_provider-integration__base`（独立タスク：translator/agent-pool/errors を import するが、それらは Phase 1/2 で既に master 入り済み）

**Files:**
- Create: `.opencode/plugins/cursor-provider/stream-proxy.ts`
- Create: `tests/stream-proxy.test.ts`

**コンテキスト:** 設計書 §5.3 / §7.2 / §7.3 / §7.4。`agent.send(msg, { onDelta, onStep })` を `ReadableStream<LanguageModelV2StreamPart>` に変換。`safeEnqueue` / `safeClose` ガードで二重終端 `TypeError` 物理防止。`hasEmittedDelta` でリトライ境界を追跡。

- [ ] **Step 1: ブランチ作成**

```bash
git checkout master && git pull
git checkout -b feature/phase3_provider-integration__base
git push -u origin feature/phase3_provider-integration__base
git checkout -b feature/phase3-task1_stream-proxy
```

- [ ] **Step 2: 失敗するテスト作成 (`tests/stream-proxy.test.ts`)**

```ts
import { describe, it, expect, vi } from "vitest";
import { createStream } from "../.opencode/plugins/cursor-provider/stream-proxy";
import { createLogger } from "../.opencode/plugins/cursor-provider/logger";

// `@cursor/sdk` の例外型をテスト内で生成するため、軽量モックを定義する。
// `isRetryable` プロパティは NetworkError のみ classifyError 経由で参照される。
vi.mock("@cursor/sdk", () => ({
  NetworkError: class extends Error { isRetryable = true; },
  UnknownAgentError: class extends Error {},
  AuthenticationError: class extends Error {},
  ConfigurationError: class extends Error {},
  RateLimitError: class extends Error {},
  IntegrationNotConnectedError: class extends Error {},
  CursorSdkError: class extends Error {},
}));

const log = createLogger({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() });

const fakeAgent = (impl: (cb: (u: any) => void) => Promise<{ status: string }>) => ({
  send: vi.fn(async (_msg: string, opts: any) => {
    const status = await impl(opts.onDelta);
    return { wait: async () => ({ status }) };
  }),
  close: vi.fn(),
}) as any;

async function collect(stream: ReadableStream<any>): Promise<any[]> {
  const reader = stream.getReader();
  const out: any[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    out.push(value);
  }
  return out;
}

describe("stream-proxy", () => {
  it("TextDeltaUpdate → text-delta", async () => {
    const agent = fakeAgent(async (onDelta) => {
      onDelta({ type: "text-delta", text: "hello" });
      onDelta({ type: "turn-ended" });
      return { status: "finished" };
    });
    const { stream } = createStream({ agent, message: "m", log });
    const parts = await collect(stream);
    expect(parts.some((p) => p.type === "text-delta" && p.text === "hello")).toBe(true);
    expect(parts.at(-1)?.type).toBe("finish");
  });

  it("ThinkingDeltaUpdate → reasoning-delta", async () => {
    const agent = fakeAgent(async (onDelta) => {
      onDelta({ type: "thinking-delta", text: "reasoning..." });
      onDelta({ type: "turn-ended" });
      return { status: "finished" };
    });
    const { stream } = createStream({ agent, message: "m", log });
    const parts = await collect(stream);
    expect(parts.some((p) => p.type === "reasoning-delta")).toBe(true);
  });

  it("ToolCallStartedUpdate → 警告 text-delta は同 toolCallId で 1 回のみ", async () => {
    const agent = fakeAgent(async (onDelta) => {
      onDelta({ type: "tool-call-started", toolCallId: "t1", toolName: "shell" });
      onDelta({ type: "tool-call-started", toolCallId: "t1", toolName: "shell" });
      onDelta({ type: "turn-ended" });
      return { status: "finished" };
    });
    const { stream } = createStream({ agent, message: "m", log });
    const parts = await collect(stream);
    const warnings = parts.filter((p) => p.type === "text-delta" && /Cursor agent attempted/.test(p.text));
    expect(warnings).toHaveLength(1);
  });

  it("PartialToolCallUpdate / ToolCallCompletedUpdate はドロップ", async () => {
    const agent = fakeAgent(async (onDelta) => {
      onDelta({ type: "tool-call-partial", arguments: '{"foo":' });
      onDelta({ type: "tool-call-completed", toolCallId: "t1" });
      onDelta({ type: "turn-ended" });
      return { status: "finished" };
    });
    const { stream } = createStream({ agent, message: "m", log });
    const parts = await collect(stream);
    expect(parts.some((p) => p.type === "text-delta" && /foo/.test(p.text))).toBe(false);
  });

  it("status=error で error パート enqueue + close (controller.error は呼ばない)", async () => {
    const agent = fakeAgent(async () => ({ status: "error" }));
    const { stream } = createStream({ agent, message: "m", log });
    const parts = await collect(stream);
    expect(parts.some((p) => p.type === "error")).toBe(true);
  });

  it("AbortSignal でストリームがクローズされる", async () => {
    const ac = new AbortController();
    const agent = fakeAgent(async (onDelta) => {
      onDelta({ type: "text-delta", text: "x" });
      ac.abort();
      await new Promise((r) => setTimeout(r, 10));
      return { status: "cancelled" };
    });
    const { stream } = createStream({ agent, message: "m", log, abortSignal: ac.signal });
    const parts = await collect(stream);
    expect(parts.some((p) => p.type === "finish" && p.finishReason === "abort")).toBe(true);
  });

  it("TurnEnded 後の status=finished で重複 close されない (hasClosedStream ガード)", async () => {
    const agent = fakeAgent(async (onDelta) => {
      onDelta({ type: "turn-ended" });
      return { status: "finished" };
    });
    const { stream, done } = createStream({ agent, message: "m", log });
    await collect(stream);
    await expect(done).resolves.toEqual({ finishReason: "stop" });
  });

  it("done は status=error 経路で finishReason='error' を解決する", async () => {
    const agent = fakeAgent(async () => ({ status: "error" }));
    const { stream, done } = createStream({ agent, message: "m", log });
    await collect(stream);
    await expect(done).resolves.toEqual({ finishReason: "error" });
  });

  it("ReadableStream の cancel() は内部 abort 経路に集約され done は finishReason='abort' を解決する", async () => {
    let releaseAgent!: () => void;
    const agentReleased = new Promise<void>((r) => { releaseAgent = r; });
    const agent = fakeAgent(async () => {
      // consumer の cancel() を待ってから返す: cancel() が internalAbort を
      // 発火させて IIFE の早期終了パスへ合流することを検証する。
      await agentReleased;
      return { status: "cancelled" };
    });
    const { stream, done } = createStream({ agent, message: "m", log });
    const reader = stream.getReader();
    await reader.cancel();
    releaseAgent();
    await expect(done).resolves.toEqual({ finishReason: "abort" });
  });

  it("hasEmittedDelta=true 時の NetworkError はリトライ発火せず error パートを流す", async () => {
    const { NetworkError } = await import("@cursor/sdk");
    const err = new NetworkError("flap");
    (err as any).isRetryable = true;
    const agent = fakeAgent(async (onDelta) => {
      onDelta({ type: "text-delta", text: "first chunk" });
      throw err;
    });
    const { stream } = createStream({ agent, message: "m", log });
    const parts = await collect(stream);
    expect(parts.filter((p) => p.type === "text-delta")).toHaveLength(1);
    expect(parts.some((p) => p.type === "error")).toBe(true);
  });

  it("未知イベント型は debug ログのみで enqueue しない", async () => {
    const debugSpy = vi.fn();
    const localLog = createLogger({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: debugSpy });
    const agent = fakeAgent(async (onDelta) => {
      onDelta({ type: "unknown-future-event" });
      onDelta({ type: "turn-ended" });
      return { status: "finished" };
    });
    const { stream } = createStream({ agent, message: "m", log: localLog });
    const parts = await collect(stream);
    expect(parts.some((p) => p.type === "text-delta")).toBe(false);
  });

  it("pre-stream NetworkError リトライ後の status=error で error パートが enqueue される", async () => {
    const { NetworkError } = await import("@cursor/sdk");
    const err = new NetworkError("flap");
    (err as any).isRetryable = true;
    let calls = 0;
    const agent = {
      send: vi.fn(async (_msg: string, _opts: any) => {
        calls += 1;
        if (calls === 1) throw err;
        return { wait: async () => ({ status: "error" }) };
      }),
      close: vi.fn(),
    } as any;
    const { stream, done } = createStream({ agent, message: "m", log });
    const parts = await collect(stream);
    expect(calls).toBe(2);
    expect(parts.some((p) => p.type === "error")).toBe(true);
    await expect(done).resolves.toMatchObject({ finishReason: "error" });
  });

  it("UnknownAgentError + recreateAgent あり: 1 回再試行して成功する", async () => {
    const { UnknownAgentError } = await import("@cursor/sdk");
    const err = new UnknownAgentError("agent gone");
    const oldAgent = {
      send: vi.fn(async () => { throw err; }),
      close: vi.fn(),
    } as any;
    const newAgent = fakeAgent(async (onDelta) => {
      onDelta({ type: "text-delta", text: "from-new" });
      onDelta({ type: "turn-ended" });
      return { status: "finished" };
    });
    const recreateAgent = vi.fn(async () => ({ agent: newAgent, message: "full-prompt" }));
    const { stream, done } = createStream({ agent: oldAgent, message: "m", log, recreateAgent });
    const parts = await collect(stream);
    expect(recreateAgent).toHaveBeenCalledTimes(1);
    // 新規 agent には完全プロンプトが渡される（latestUserMessage ではない）。
    expect(newAgent.send).toHaveBeenCalledWith("full-prompt", expect.any(Object));
    expect(parts.some((p) => p.type === "text-delta" && p.text === "from-new")).toBe(true);
    await expect(done).resolves.toEqual({ finishReason: "stop" });
  });

  it("UnknownAgentError + recreateAgent あり: 再試行も失敗すると errorType 付きで終端する", async () => {
    const { UnknownAgentError } = await import("@cursor/sdk");
    const err = new UnknownAgentError("agent gone");
    const oldAgent = { send: vi.fn(async () => { throw err; }), close: vi.fn() } as any;
    const recreateAgent = vi.fn(async () => { throw new Error("create failed"); });
    const { stream, done } = createStream({ agent: oldAgent, message: "m", log, recreateAgent });
    const parts = await collect(stream);
    expect(parts.some((p) => p.type === "error")).toBe(true);
    await expect(done).resolves.toEqual({ finishReason: "error", errorType: "UnknownAgentError" });
  });

  it("UnknownAgentError + recreateAgent なし: リトライせず error パートを流す", async () => {
    const { UnknownAgentError } = await import("@cursor/sdk");
    const err = new UnknownAgentError("agent gone");
    const oldAgent = { send: vi.fn(async () => { throw err; }), close: vi.fn() } as any;
    const { stream, done } = createStream({ agent: oldAgent, message: "m", log });
    const parts = await collect(stream);
    expect(parts.some((p) => p.type === "error")).toBe(true);
    await expect(done).resolves.toMatchObject({ finishReason: "error" });
  });
});
```

- [ ] **Step 3: テスト失敗確認 → 実装作成**

`createStream` 実装。`safeEnqueue` / `safeClose` ガード、`hasEmittedDelta` 状態追跡、`onDelta` 分岐、`run.wait()` 後の status 分岐を含む。設計書 §5.3 / §7.2 にコード例あり。

- [ ] **Step 4: 実装作成 (`.opencode/plugins/cursor-provider/stream-proxy.ts`)**

```ts
import type { Agent as SDKAgent } from "@cursor/sdk";
import type { Logger } from "./logger.js";
import { classifyError, logError } from "./errors.js";

export interface StreamProxyInput {
  agent: SDKAgent;
  message: string;
  log: Logger;
  abortSignal?: AbortSignal;
  // pre-stream で UnknownAgentError を捕捉した際に呼ばれる新規 Agent 生成
  // コールバック。プールヒット由来でこのコールバックが定義されている場合のみ
  // 1 回だけ再試行する。
  // 戻り値の `message` は再送信時に使う文字列（呼出側が `fullPromptOnMiss` を
  // 渡す）。新規 agent には会話履歴が無いため `latestUserMessage` ではなく
  // 完全プロンプトを送る必要がある（design §5.3 / §6.1）。
  // pool.delete / Agent.create リトライ吸収は呼出側 (runDoStream) のクロージャ責務。
  recreateAgent?: () => Promise<{ agent: SDKAgent; message: string }>;
}

const TOOL_WARNING = (name: string) =>
  `⚠️ [cursor-provider] Cursor agent attempted to use tool: ${name}. Pure LLM mode is in effect; the tool call is surfaced for visibility but not executed by OpenCode.`;

export type StreamFinishReason = "stop" | "abort" | "error";

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
  stream: ReadableStream<any>;
  done: Promise<{ finishReason: StreamFinishReason; errorType?: StreamErrorType }>;
} {
  const { agent: initialAgent, message, log, abortSignal, recreateAgent } = input;
  // initialAgent は再試行で差し替えられる可能性があるため let で保持。
  let agent = initialAgent;
  let hasClosedStream = false;
  let hasEmittedDelta = false;
  // 終端理由は最初に確定したものを採用する（`safeClose` と同じ "prefer-first" 規則）。
  // 後続の異常系イベントが正常終了のレポートを上書きしてしまうのを防ぐ。
  let finishReason: StreamFinishReason | null = null;
  const warnedToolCallIds = new Set<string>();
  let controller!: ReadableStreamDefaultController<any>;

  // 内部 AbortController: 外部 abortSignal と consumer の cancel() を集約する。
  // IIFE のアボート判定は内部シグナルのみ参照し、cancel() からの早期終了経路を
  // 外部 abort と同じロジックで扱う。
  const internalAbort = new AbortController();
  const onExternalAbort = () => internalAbort.abort();
  abortSignal?.addEventListener("abort", onExternalAbort);

  const setFinishReason = (reason: StreamFinishReason) => {
    if (finishReason === null) finishReason = reason;
  };

  const safeEnqueue = (part: any) => {
    if (hasClosedStream) {
      log.debug("stream-proxy: enqueue after close ignored", { partType: part.type });
      return;
    }
    if (part.type === "text-delta" || part.type === "reasoning-delta") hasEmittedDelta = true;
    if (part.type === "finish") setFinishReason(part.finishReason);
    if (part.type === "error") setFinishReason("error");
    controller.enqueue(part);
  };
  const safeClose = () => {
    if (hasClosedStream) return;
    hasClosedStream = true;
    controller.close();
  };

  const onDelta = (u: any) => {
    switch (u.type) {
      case "text-delta":
        safeEnqueue({ type: "text-delta", text: u.text });
        break;
      case "thinking-delta":
        safeEnqueue({ type: "reasoning-delta", text: u.text });
        break;
      case "tool-call-started": {
        const id = u.toolCallId ?? u.toolName;
        if (warnedToolCallIds.has(id)) break;
        warnedToolCallIds.add(id);
        log.warn("cursor: unexpected tool-call in Pure LLM mode", {
          toolName: u.toolName, toolCallId: u.toolCallId,
        });
        safeEnqueue({ type: "text-delta", text: TOOL_WARNING(u.toolName ?? "unknown") });
        break;
      }
      case "tool-call-partial":
      case "tool-call-completed":
        log.debug("stream-proxy: drop tool-call detail", { type: u.type });
        break;
      case "turn-ended":
        safeEnqueue({ type: "finish", finishReason: "stop" });
        safeClose();
        break;
      default:
        log.debug("stream-proxy: unknown update", { type: u.type });
    }
  };

  // 異常終端時の分類タグ。`finishReason !== "stop"` のとき、catch 経路で
  // 捕捉した例外の `err.constructor.name` を保存して `done` の解決値に含める。
  // 呼出側 (runDoStream) が UnknownAgentError リトライ後の pool.put 等を判定するために用いる。
  let lastErrorType: StreamErrorType | undefined;
  const captureErrorType = (err: unknown) => {
    lastErrorType = ((err as Error)?.constructor?.name ?? "Error") as StreamErrorType;
  };

  let donePromiseResolve!: (v: { finishReason: StreamFinishReason; errorType?: StreamErrorType }) => void;
  const done = new Promise<{ finishReason: StreamFinishReason; errorType?: StreamErrorType }>((r) => {
    donePromiseResolve = r;
  });

  // run.wait() の status を finish/error パート enqueue + safeClose に変換する共通分岐。
  // 主経路と pre-stream リトライ経路で同じセマンティクスを保つために抽出する
  // （リトライ経路で status を破棄して即 safeClose する実装は consumer に
  // エラーが届かないため禁止 / design §7.3）。
  const handleRunStatus = (result: { status: string }) => {
    if (result.status === "finished") {
      safeEnqueue({ type: "finish", finishReason: "stop" });
      safeClose();
    } else if (result.status === "cancelled") {
      log.warn("stream-proxy: run cancelled");
      safeEnqueue({ type: "finish", finishReason: "abort" });
      safeClose();
    } else {
      log.error("stream-proxy: run.status non-finished", { status: result.status });
      safeEnqueue({ type: "error", error: { message: `cursor: status=${result.status}` } });
      safeClose();
    }
  };

  const stream = new ReadableStream<any>({
    start(c) {
      controller = c;
      const onAbort = () => {
        log.warn("stream-proxy: abort signal received");
        setFinishReason("abort");
        safeEnqueue({ type: "finish", finishReason: "abort" });
        safeClose();
      };
      internalAbort.signal.addEventListener("abort", onAbort);

      (async () => {
        // 起動前に既に abort 済みの場合は早期終了。abort listener はまだ stream
        // に attach 済みのため、ダウンストリームへの finish(abort) はそちらに委ねる。
        if (internalAbort.signal.aborted) {
          // listener が未発火のケース（addEventListener 直前に既に aborted）に備え、
          // finish(abort) を 1 度だけ enqueue。`hasClosedStream` ガードで二重発火を防ぐ。
          setFinishReason("abort");
          safeEnqueue({ type: "finish", finishReason: "abort" });
          safeClose();
          donePromiseResolve({ finishReason: finishReason ?? "abort" });
          return;
        }
        try {
          // NOTE: `agent.send` への AbortSignal 引き渡しは @cursor/sdk が
          // `{ signal }` オプションを公式サポートした時点で追加する（現状 SDK 仕様
          // 未確認のため未渡し）。現実装では abort listener 経由でダウンストリームを
          // 即時クローズし、上位の `runDoStream` 側で `done` の解決値に含まれる
          // `finishReason` に基づき pool.delete / disposeAgentSafely を実行することで
          // SDK 側の継続実行による副作用を抑える。
          const run = await agent.send(message, { onDelta });
          const result = await (run as any).wait();
          handleRunStatus(result);
        } catch (err) {
          const phase = !hasEmittedDelta ? "pre-stream" : "in-stream";
          const errName = (err as Error)?.constructor?.name;

          // UnknownAgentError 専用パス: pre-stream かつ recreateAgent がある場合
          // のみ、新規 agent で 1 回だけ再試行する（design §7.1）。新規 agent は
          // 履歴を持たないため、再送信メッセージは recreateAgent の戻り値から
          // 受け取る（呼出側が fullPromptOnMiss 相当を返す責務）。
          // pool.delete / Agent.create リトライ吸収は recreateAgent クロージャ側の責務。
          if (
            phase === "pre-stream" &&
            errName === "UnknownAgentError" &&
            recreateAgent &&
            !internalAbort.signal.aborted
          ) {
            log.warn("stream-proxy: UnknownAgentError; retrying with new agent");
            try {
              const recreated = await recreateAgent();
              agent = recreated.agent;
              const run = await agent.send(recreated.message, { onDelta });
              const result = await (run as any).wait();
              handleRunStatus(result);
            } catch (err2) {
              captureErrorType(err);  // 元の UnknownAgentError を errorType として保持
              logError(log, err2, { phase: "create", retry: false });
              safeEnqueue({ type: "error", error: { message: (err2 as Error).message } });
              safeClose();
            }
            return;
          }

          const decision = classifyError(err, { phase });
          logError(log, err, { phase, retry: decision.retry });
          if (!decision.retry) {
            captureErrorType(err);
            safeEnqueue({ type: "error", error: { message: (err as Error).message } });
            safeClose();
          } else {
            // retry handling delegated to caller for create phase; here in pre-stream we just retry once
            await new Promise((r) => setTimeout(r, decision.delayMs));
            // バックオフ中にユーザーが abort した場合はリトライをスキップして終了。
            // ここで早期 return しないと、SDK の `agent.send` に signal が渡せない
            // 現状仕様（前述 NOTE 参照）下でリトライ呼出が完走するまで止まらず、
            // 不要なリソース消費とログノイズの原因になる。consumer 側の cancel()
            // 経路も `internalAbort` 経由でここを通る。
            if (internalAbort.signal.aborted) {
              safeEnqueue({ type: "finish", finishReason: "abort" });
              safeClose();
            } else {
              try {
                const run = await agent.send(message, { onDelta });
                const result = await (run as any).wait();
                // リトライ経路でも主経路と同じ status 分岐を行う（design §7.3）。
                // status 破棄して即 safeClose すると status="error"/"cancelled" 時に
                // consumer がエラー通知を受け取れずストリームが無言終了する。
                handleRunStatus(result);
              } catch (err2) {
                captureErrorType(err2);
                safeEnqueue({ type: "error", error: { message: (err2 as Error).message } });
                safeClose();
              }
            }
          }
        } finally {
          internalAbort.signal.removeEventListener("abort", onAbort);
          abortSignal?.removeEventListener("abort", onExternalAbort);
          // 通常経路ではいずれかの safeEnqueue で finishReason が確定する。
          // ガードに弾かれて未確定のまま finally に到達するのは consumer の
          // cancel() 直後のみで、この場合 cancel() 自体が "abort" を予約済み。
          // 理論上の保険としてフォールバックを "abort" にする。
          // errorType は finishReason !== "stop" のときのみ付与する（"stop" 時に
          // 残骸が残らないようガード）。abort 時も errorType は省略する。
          const resolvedReason = finishReason ?? "abort";
          donePromiseResolve(
            resolvedReason === "error" && lastErrorType
              ? { finishReason: resolvedReason, errorType: lastErrorType }
              : { finishReason: resolvedReason },
          );
        }
      })();
    },
    cancel() {
      // 二重クローズ防止フラグを先に立て、続いて内部 abort で IIFE の早期終了
      // パスを発火させる。`controller.close()` をここで直接呼ばないのは、
      // ReadableStream の cancel() 経由では controller が既に終端遷移中のため
      // close() が `TypeError: Cannot close a stream that has already been
      // requested to be closed` を投げる可能性があるため。終端理由は cancel()
      // の発生源を反映して "abort" 固定とする。
      hasClosedStream = true;
      setFinishReason("abort");
      internalAbort.abort();
    },
  });

  return { stream, done };
}
```

- [ ] **Step 5: テスト通過 + 型確認**

```bash
pnpm test -- tests/stream-proxy.test.ts
pnpm typecheck
```

- [ ] **Step 6: コミット + Draft PR (→ Phase 3 base)**

```bash
git add .opencode/plugins/cursor-provider/stream-proxy.ts tests/stream-proxy.test.ts
git commit -m "feat(cursor-provider): stream-proxy (二重終端ガード + リトライ境界追跡)"
git push -u origin feature/phase3-task1_stream-proxy
gh pr create --draft --base feature/phase3_provider-integration__base \
  --title "feat(cursor-provider): stream-proxy" \
  --body "## Summary
- safeEnqueue / safeClose ガードで二重終端を物理防止
- hasEmittedDelta でリトライ境界追跡 (in-stream は retry 不可)
- ToolCallStarted は toolCallId 単位で 1 回のみ警告

## Test plan
- [ ] tests/stream-proxy.test.ts 全 PASS"
```

---

### Task 3.2: `provider.ts` ProviderHook 本体

**派生元:** `feature/phase3-task1_stream-proxy`（**依存タスク：stream-proxy の export を直接 import するため数珠つなぎ**）

**Files:**
- Create: `.opencode/plugins/cursor-provider/provider.ts`
- Create: `tests/provider.test.ts`

**コンテキスト:** 設計書 §5.4 / §6.2 / §6.3。`createProviderHook` が `models()` で `Cursor.models.list({ apiKey })` を 5s タイムアウトで呼び、失敗時は静的フォールバック。各モデルの `doStream` 実装は `translator → pool.tryGet → Agent.create → stream-proxy.createStream` の合成。エラー経路の agent cleanup は Task 2.1 で作成した `agent-cleanup.ts` の `disposeAgentSafely` を再利用する（pool 経由 / 非 pool いずれも同関数を経由してハング保護を一様適用）。

- [ ] **Step 1: ブランチ作成（直前 Task から）**

```bash
git checkout feature/phase3-task1_stream-proxy
git checkout -b feature/phase3-task2_provider
```

- [ ] **Step 2: 失敗するテスト作成 (`tests/provider.test.ts`)**

```ts
import { describe, it, expect, vi } from "vitest";
import { createProviderHook } from "../.opencode/plugins/cursor-provider/provider";
import { createAgentPool } from "../.opencode/plugins/cursor-provider/agent-pool";
import { createLogger } from "../.opencode/plugins/cursor-provider/logger";

vi.mock("@cursor/sdk", async () => ({
  Cursor: {
    models: { list: vi.fn() },
  },
  Agent: { create: vi.fn() },
  AuthenticationError: class extends Error {},
  ConfigurationError: class extends Error {},
  RateLimitError: class extends Error {},
  NetworkError: class extends Error { isRetryable = true; },
  IntegrationNotConnectedError: class extends Error {},
  UnknownAgentError: class extends Error {},
  CursorSdkError: class extends Error {},
}));

const log = createLogger({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() });

describe("createProviderHook.models()", () => {
  it("Cursor.models.list 成功時に SDKModel を ModelV2 化して返す", async () => {
    const sdk = await import("@cursor/sdk");
    (sdk.Cursor.models.list as any).mockResolvedValue([
      { id: "composer-2", name: "Composer 2", contextWindow: 200000 },
    ]);
    const hook = createProviderHook({
      resolveApiKey: async () => "key",
      log,
      pool: createAgentPool({ log, capacity: 8 }),
    });
    const ctx: any = { auth: { get: async () => undefined } };
    const result = await hook.models("cursor", ctx);
    expect(result instanceof Map ? result.has("composer-2") : Object.keys(result).includes("composer-2")).toBe(true);
  });

  it("list 失敗時に静的フォールバック", async () => {
    const sdk = await import("@cursor/sdk");
    (sdk.Cursor.models.list as any).mockRejectedValue(new Error("network"));
    const hook = createProviderHook({
      resolveApiKey: async () => "key",
      log,
      pool: createAgentPool({ log, capacity: 8 }),
    });
    const ctx: any = { auth: { get: async () => undefined } };
    const r = await hook.models("cursor", ctx);
    const keys = r instanceof Map ? [...r.keys()] : Object.keys(r);
    expect(keys.includes("composer-2")).toBe(true);
  });

  it("apiKey 未解決でも静的フォールバックを返す", async () => {
    const hook = createProviderHook({
      resolveApiKey: async () => undefined,
      log,
      pool: createAgentPool({ log, capacity: 8 }),
    });
    const ctx: any = { auth: { get: async () => undefined } };
    const r = await hook.models("cursor", ctx);
    const keys = r instanceof Map ? [...r.keys()] : Object.keys(r);
    expect(keys.includes("composer-2")).toBe(true);
  });

  it("list 5s タイムアウトでフォールバック", async () => {
    vi.useFakeTimers();
    const sdk = await import("@cursor/sdk");
    (sdk.Cursor.models.list as any).mockImplementation(() => new Promise(() => {}));
    const hook = createProviderHook({
      resolveApiKey: async () => "key",
      log,
      pool: createAgentPool({ log, capacity: 8 }),
    });
    const ctx: any = { auth: { get: async () => undefined } };
    const p = hook.models("cursor", ctx);
    vi.advanceTimersByTime(5000);
    const r = await p;
    const keys = r instanceof Map ? [...r.keys()] : Object.keys(r);
    expect(keys.includes("composer-2")).toBe(true);
    vi.useRealTimers();
  });
});
```

- [ ] **Step 3: テスト失敗確認 → 実装**

- [ ] **Step 4: 実装作成 (`.opencode/plugins/cursor-provider/provider.ts`)**

```ts
import { Cursor, Agent } from "@cursor/sdk";
import type { ProviderHook, ProviderHookContext } from "@opencode-ai/plugin";
import type { Logger } from "./logger.js";
import type { AgentPool } from "./agent-pool.js";
import { fingerprintApiKey } from "./agent-pool.js";
import { disposeAgentSafely } from "./agent-cleanup.js";
import { translate } from "./translator.js";
import { createStream } from "./stream-proxy.js";
import { STATIC_FALLBACK_MODELS, makeModelMeta } from "./models.js";
import { classifyError, logError } from "./errors.js";

const MODELS_LIST_TIMEOUT_MS = 5_000;

async function listModelsWithTimeout(apiKey: string, log: Logger) {
  return await Promise.race([
    Cursor.models.list({ apiKey }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("models.list timeout")), MODELS_LIST_TIMEOUT_MS),
    ),
  ]).catch((err) => {
    log.warn("cursor-provider: models.list failed; using static fallback", {
      errorType: (err as Error).constructor.name,
    });
    return null;
  });
}

export function createProviderHook(deps: {
  resolveApiKey: (ctx: ProviderHookContext) => Promise<string | undefined>;
  log: Logger;
  pool: AgentPool;
}): ProviderHook {
  const { resolveApiKey, log, pool } = deps;
  // chat.params 警告フラグはフック単位で保持する。モジュールスコープに置くと
  // 複数のテストがプロセス内で同じプラグインモジュールを共有した際、最初の
  // テストで一度発火した警告が他テストで再現できなくなり、テスト間の独立性が
  // 崩れる。`createProviderHook` ごとにフラグを生成することで、テストは
  // 新しいフックを作るだけで初期状態に戻せる。
  let warnedParamsOnce = false;

  return {
    id: "cursor",
    async models(_provider: string, ctx: ProviderHookContext) {
      const apiKey = await resolveApiKey(ctx);
      let models: Array<{ id: string; name?: string; contextWindow?: number }> | null = null;
      if (apiKey) models = await listModelsWithTimeout(apiKey, log);
      if (!models) {
        models = STATIC_FALLBACK_MODELS.map((m) => ({ id: m.id, name: m.name, contextWindow: m.contextWindow }));
      }

      const out = new Map<string, any>();
      for (const m of models) {
        const meta = makeModelMeta({
          id: m.id,
          name: m.name ?? m.id,
          contextWindow: m.contextWindow ?? 200_000,
        });
        out.set(m.id, {
          ...meta,
          // doStream は `models()` 呼出時の apiKey をクロージャに固定せず、
          // 毎回 `resolveApiKey(ctx)` を再評価する。これにより
          // `CURSOR_API_KEY` の差し替えや `opencode auth` での再認証が
          // モデル一覧を再取得しなくても次の doStream から反映される。
          // `ctx` 自体は `models()` 時点で確定するが、`resolveApiKey` は内部で
          // env / auth ストアを毎回参照する想定なので、最新値が拾える。
          async doStream(args: any) {
            const currentApiKey = await resolveApiKey(ctx);
            return await runDoStream({
              args,
              modelId: m.id,
              apiKey: currentApiKey,
              log,
              pool,
              warnState: {
                hasWarned: () => warnedParamsOnce,
                markWarned: () => { warnedParamsOnce = true; },
              },
            });
          },
        });
      }
      return out;
    },
  };
}

async function runDoStream(opts: {
  args: { prompt: any; abortSignal?: AbortSignal; chatParams?: any };
  modelId: string;
  apiKey: string | undefined;
  log: Logger;
  pool: AgentPool;
  warnState: { hasWarned: () => boolean; markWarned: () => void };
}) {
  const { args, modelId, apiKey, log, pool, warnState } = opts;
  if (!apiKey) {
    log.error("cursor-provider: doStream invoked without API key");
    throw new Error("Cursor API key is not set; run 'opencode auth login cursor' or export CURSOR_API_KEY");
  }
  if (!warnState.hasWarned() && args.chatParams && Object.keys(args.chatParams).length > 0) {
    warnState.markWarned();
    log.warn("cursor-provider: chat.params not supported by Cursor SDK; ignored", {
      paramKeys: Object.keys(args.chatParams),
    });
  }

  const t = translate(args.prompt);
  const fingerprint = fingerprintApiKey(apiKey);
  const hit = pool.tryGet(t.prefixHash, modelId, apiKey);
  let agent;
  let messageToSend: string;
  if (hit) {
    log.debug("cursor-provider: pool hit", { prefixHash: t.prefixHash.slice(0, 8) });
    agent = hit.agent;
    messageToSend = t.latestUserMessage;
  } else {
    log.debug("cursor-provider: pool miss", { prefixHash: t.prefixHash.slice(0, 8) });
    agent = await createAgentWithRetry({ apiKey, modelId, log });
    messageToSend = t.fullPromptOnMiss;
  }

  const wasMiss = !hit;

  // UnknownAgentError リトライで差し替えられた新 agent を保持する。
  // stream-proxy の `recreateAgent` クロージャが side-effect で書き込み、
  // done 解決時の pool 操作（rekey vs. put）を分岐するために参照する。
  let replacedAgent: typeof agent | undefined;

  // pool ヒット経由のみ recreateAgent を提供する。pool ミス経由では
  // 直前に Agent.create したばかりの新規 agent なので UnknownAgentError は
  // 通常発生しない前提（design §6.2）。
  // 新規 agent には先行会話の履歴が無いため、再送信メッセージは
  // `latestUserMessage` ではなく `fullPromptOnMiss` を使う（design §5.3）。
  const recreateAgent = hit
    ? async () => {
        // 古いプールエントリは確実に除去（pool.delete 内部で disposeAgentSafely
        // 経由 = 5s タイムアウト付き asyncDispose）。
        await pool.delete(t.prefixHash, modelId, apiKey);
        const fresh = await createAgentWithRetry({ apiKey, modelId, log });
        replacedAgent = fresh;
        return { agent: fresh, message: t.fullPromptOnMiss };
      }
    : undefined;

  const { stream, done } = createStream({
    agent,
    message: messageToSend,
    log,
    abortSignal: args.abortSignal,
    recreateAgent,
  });

  done.then(async ({ finishReason, errorType }) => {
    // 終端理由に応じて pool 操作を分岐する。`abortSignal.aborted` のみで判定
    // していた旧実装は status=error / cancelled / 例外経路を取りこぼし、
    // 異常状態の agent を pool.put / pool.rekey で次ターンに引き継いでしまう
    // 不具合があったため、createStream の解決値を契約として参照する。
    if (finishReason === "stop") {
      if (replacedAgent) {
        // UnknownAgentError リトライで agent が差し替わった場合は、新 agent を
        // nextHash で登録する（pool.rekey は古いキーを既に削除済みなのでスキップ）。
        // design §6.1 の "UnknownAgentError リトライ後の継続性維持" を実装。
        await pool.put(t.nextHash, {
          agent: replacedAgent,
          lastUsedAt: Date.now(),
          modelId,
          apiKeyFingerprint: fingerprint,
        });
        return;
      }
      if (wasMiss) {
        // miss 経路は最初から `nextHash` に直接 put する（design §6.2 step 6-a）。
        // 旧実装は `await pool.put(prefixHash) → rekey(prefixHash → nextHash)` の
        // 二段階だったが、`await pool.put` 中の event-loop yield 中に他リクエストが
        // `tryGet(prefixHash)` で中途状態の agent を掴み、続く rekey で削除されて
        // 別リクエストの `pool.delete(prefixHash)` が no-op になる race window が
        // 存在した。直接 `nextHash` に登録すれば prefixHash が一時的に露出することは
        // ない（既存の同一 prefixHash エントリは別ユーザー/別前回ターンのものなので
        // ここでは触らない）。
        await pool.put(t.nextHash, {
          agent,
          lastUsedAt: Date.now(),
          modelId,
          apiKeyFingerprint: fingerprint,
        });
      } else {
        // hit 経路は前ターン末で nextHash に置かれたエントリを今ターンの prefixHash で
        // 引いたケース。今ターン末はそれを今ターンの nextHash へ移すだけで良い。
        pool.rekey(fingerprint, modelId, t.prefixHash, t.nextHash);
      }
      return;
    }
    // abort / error: agent は既に部分的にメッセージを受信／中断済みで、
    // SDK 内部状態が破損している可能性がある。プール再利用を避けるため、
    // ヒット経由のエントリは pool.delete（内部で disposeAgentSafely 経由）し、
    // ミス経由 / replacedAgent は pool 未登録なので disposeAgentSafely を直接呼ぶ。
    // SDK 仕様上 `close()` は同期 void なので timeout 保護にならない。エラー経路
    // でも一様に asyncDispose + 5s timeout の `disposeAgentSafely` を使う。
    // errorType は記録のみ（pool 操作の分岐には使用しない）。
    if (errorType) log.debug("cursor-provider: stream ended with errorType", { errorType });
    if (replacedAgent) {
      // UnknownAgentError リトライ後の失敗。新 agent は pool 未登録。
      await disposeAgentSafely(replacedAgent, log);
      return;
    }
    if (hit) await pool.delete(t.prefixHash, modelId, apiKey);
    else await disposeAgentSafely(agent, log);
  }).catch((err) => logError(log, err, { phase: "post-stream" }));

  return { stream };
}

// `Agent.create` を呼び、NetworkError 等のリトライ可能例外は 1 回だけ
// `classifyError({ phase: "create" })` の `delayMs` バックオフで再試行する。
// design §7.1 / §6.2 ステップ 4 の create-phase リトライをここで吸収し、
// stream-proxy 側からは「単一試行で成功 or 失敗」のシンプルな契約に保つ。
async function createAgentWithRetry(deps: { apiKey: string; modelId: string; log: Logger }) {
  const { apiKey, modelId, log } = deps;
  try {
    return await Agent.create({ apiKey, model: { id: modelId }, local: { cwd: process.cwd() } });
  } catch (err) {
    const decision = classifyError(err, { phase: "create" });
    logError(log, err, { phase: "create", retry: decision.retry });
    if (!decision.retry) throw err;
    await new Promise((r) => setTimeout(r, decision.delayMs));
    return await Agent.create({ apiKey, model: { id: modelId }, local: { cwd: process.cwd() } });
  }
}
```

- [ ] **Step 5: テスト通過確認**

```bash
pnpm test -- tests/provider.test.ts
pnpm typecheck
```

- [ ] **Step 6: コミット + Draft PR (→ Phase 3 base)**

```bash
git add .opencode/plugins/cursor-provider/provider.ts tests/provider.test.ts
git commit -m "feat(cursor-provider): ProviderHook 本体 (models() + doStream)"
git push -u origin feature/phase3-task2_provider
gh pr create --draft --base feature/phase3_provider-integration__base \
  --title "feat(cursor-provider): ProviderHook 本体" \
  --body "## Summary
- Cursor.models.list 5s timeout / 失敗時 静的フォールバック
- doStream で translator → pool → Agent.create → stream-proxy 合成
- chat.params 警告は初回のみ

依存: feature/phase3-task1_stream-proxy

## Test plan
- [ ] tests/provider.test.ts 全 PASS"
```

---

### Task 3.3: `index.ts` Plugin エントリ + 旧 `custom-tools.ts` 削除

**派生元:** `feature/phase3-task2_provider`（**依存タスク：provider.ts を import するため数珠つなぎ**）

**Files:**
- Create: `.opencode/plugins/cursor-provider/index.ts`
- Delete: `.opencode/plugins/custom-tools.ts`
- Delete: `tests/cursor-prompt.test.ts`
- Delete: `tests/schema.test.ts`
- Modify: `package.json` (`main`, `exports`)

**コンテキスト:** 設計書 §6.4。`process.once("beforeExit"/"SIGINT"/"SIGTERM")` で `pool.closeAll()`。シグナル経路は `process.kill(process.pid, signal)` で再 raise。`AuthHook` と `ProviderHook` を一括登録。

- [ ] **Step 1: ブランチ作成（直前 Task から）**

```bash
git checkout feature/phase3-task2_provider
git checkout -b feature/phase3-task3_entry-and-cleanup
```

- [ ] **Step 2: index.ts 実装作成**

```ts
import type { Plugin } from "@opencode-ai/plugin";
import { config as loadDotenv } from "dotenv";
import { createLogger } from "./logger.js";
import { createAgentPool } from "./agent-pool.js";
import { createProviderHook } from "./provider.js";
import { resolveApiKey, cursorAuthHook } from "./auth.js";

const POOL_CAPACITY = 8;
const CLOSEALL_TIMEOUT_MS = 5_000;

const CursorProviderPlugin: Plugin = async ({ client }) => {
  if (process.env.NODE_ENV !== "test") loadDotenv();
  const log = createLogger((client.app as any).log);
  const pool = createAgentPool({ log, capacity: POOL_CAPACITY });

  const cleanup = async () => {
    await Promise.race([
      pool.closeAll(),
      new Promise<void>((r) => setTimeout(r, CLOSEALL_TIMEOUT_MS)),
    ]).catch((err) => log.warn("cursor-provider: closeAll failed", {
      errorType: (err as Error).constructor.name,
    }));
  };

  process.once("beforeExit", () => { void cleanup(); });
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.once(sig, async () => {
      log.info("cursor-provider: signal received, cleaning up", { signal: sig });
      await cleanup();
      process.kill(process.pid, sig);
    });
  }

  return {
    auth: [cursorAuthHook],
    provider: [createProviderHook({ resolveApiKey, log, pool })],
  };
};

export default CursorProviderPlugin;
```

- [ ] **Step 3: 旧ファイル削除と package.json 更新**

```bash
rm .opencode/plugins/custom-tools.ts tests/cursor-prompt.test.ts tests/schema.test.ts
```

`package.json` を編集:
```json
"main": ".opencode/plugins/cursor-provider/index.ts",
"exports": {
  ".": "./.opencode/plugins/cursor-provider/index.ts"
},
```

- [ ] **Step 4: typecheck + 全テスト確認**

```bash
pnpm typecheck
pnpm test
```
Expected: すべて PASS（cursor-prompt / schema テストは削除済み）。

- [ ] **Step 5: コミット + Draft PR (→ Phase 3 base)**

```bash
git add -A
git commit -m "feat(cursor-provider): Plugin エントリ追加 + 旧 cursor_prompt ツール削除"
git push -u origin feature/phase3-task3_entry-and-cleanup
gh pr create --draft --base feature/phase3_provider-integration__base \
  --title "feat(cursor-provider)!: Plugin エントリ + 旧ツール削除 (BREAKING)" \
  --body "## Summary
- index.ts で AuthHook + ProviderHook を一括登録
- beforeExit/SIGINT/SIGTERM で pool.closeAll (5s timeout) + シグナル再 raise
- 旧 cursor_prompt ツール完全削除 (BREAKING CHANGE)
- package.json main/exports を新 entry に更新

依存: feature/phase3-task2_provider

## Test plan
- [ ] pnpm typecheck 成功
- [ ] pnpm test 全 PASS
- [ ] cursor_prompt 関連テストが削除されていることを確認"
```

---

### Phase 3 完了: Phase Draft PR

- [ ] **Step 1: Phase 3 内 PR を順次マージ** (Task 3.1 → 3.2 → 3.3)

- [ ] **Step 2: Phase 3 → master の Draft PR**

```bash
git checkout feature/phase3_provider-integration__base
gh pr create --draft --base master \
  --title "feat(cursor-provider)!: Phase 3 ProviderHook 統合 + 旧ツール削除" \
  --body "## Summary (BREAKING)
- stream-proxy / provider / index 実装完了
- 旧 cursor_prompt ツールおよび関連テスト削除
- package.json main/exports 更新

## Test plan
- [ ] pnpm typecheck
- [ ] pnpm test 全 PASS
- [ ] 手動確認: opencode 起動 → /provider cursor 選択 → ストリーミング応答 (Task 4.2 でカバー)"
```

> **マージ条件:** CI 全 PASS、Phase 2 マージ済み。マージ完了まで Phase 4 に進まない。

---

## Phase 4: 統合テスト・ドキュメント・リリース整備

Phase 3 で確立したエンドツーエンドの実装に対し、統合テスト・E2E スクリプト・ドキュメント更新・バージョン bump を行う。

**Phase ブランチ:** `feature/phase4_release-prep__base`（Phase 3 マージ後の `master` から派生）
**Phase Draft PR ターゲット:** `master`

### Task 4.1: 統合テスト `provider-flow.test.ts`

**派生元:** `feature/phase4_release-prep__base`（独立タスク）

**Files:**
- Create: `tests/integration/provider-flow.test.ts`

**コンテキスト:** 設計書 §8.5 の 5 ケース（プールミス → put、プールヒット → rekey、LRU 退避、退避後再ミス、キャンセル後の新規 Agent.create）。`@cursor/sdk` を完全モック化し実 API は呼ばない。

- [ ] **Step 1: ブランチ作成**

```bash
git checkout master && git pull
git checkout -b feature/phase4_release-prep__base
git push -u origin feature/phase4_release-prep__base
git checkout -b feature/phase4-task1_integration-test
```

- [ ] **Step 2: 統合テスト作成**

```ts
import { describe, it, expect, vi } from "vitest";
import { createAgentPool } from "../../.opencode/plugins/cursor-provider/agent-pool";
import { createProviderHook } from "../../.opencode/plugins/cursor-provider/provider";
import { createLogger } from "../../.opencode/plugins/cursor-provider/logger";

vi.mock("@cursor/sdk", async () => {
  const agents: any[] = [];
  return {
    Cursor: { models: { list: vi.fn().mockResolvedValue([{ id: "composer-2", name: "C2", contextWindow: 200000 }]) } },
    Agent: {
      create: vi.fn(async () => {
        // SDK 仕様: `close(): void` は同期 / `[Symbol.asyncDispose](): Promise<void>` は非同期。
        // プール経由の cleanup は asyncDispose 側を使うため spy はそちらに置く。
        // close は doStream の miss-error 経路 (`(agent as any).close?.()`) で
        // optional chaining 越しに呼ばれる可能性があるので no-op 互換のため残す。
        const a = {
          send: vi.fn(async (_m: string, opts: any) => {
            opts.onDelta({ type: "text-delta", text: "hello" });
            opts.onDelta({ type: "turn-ended" });
            return { wait: async () => ({ status: "finished" }) };
          }),
          [Symbol.asyncDispose]: vi.fn().mockResolvedValue(undefined),
          close: vi.fn(),
          _id: agents.length,
        };
        agents.push(a);
        return a;
      }),
    },
    AuthenticationError: class extends Error {},
    ConfigurationError: class extends Error {},
    RateLimitError: class extends Error {},
    NetworkError: class extends Error { isRetryable = true; },
    IntegrationNotConnectedError: class extends Error {},
    UnknownAgentError: class extends Error {},
    CursorSdkError: class extends Error {},
    __agents: agents,
  };
});

const log = createLogger({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() });
const ctx: any = { auth: { get: async () => undefined } };
const sys = (t: string) => ({ role: "system" as const, content: t });
const usr = (t: string) => ({ role: "user" as const, content: [{ type: "text" as const, text: t }] });

async function drain(stream: ReadableStream<any>) {
  const r = stream.getReader();
  const out: any[] = [];
  while (true) {
    const { value, done } = await r.read();
    if (done) break;
    out.push(value);
  }
  return out;
}

describe("integration: provider-flow", () => {
  it("プールミス → put、続いてプールヒット → rekey", async () => {
    process.env.CURSOR_API_KEY = "test-key";
    const pool = createAgentPool({ log, capacity: 8 });
    const hook = createProviderHook({ resolveApiKey: async () => "test-key", log, pool });
    const models = await hook.models("cursor", ctx) as Map<string, any>;
    const m = models.get("composer-2")!;

    // turn 1
    const r1 = await m.doStream({ prompt: [sys("S"), usr("U1")] });
    await drain(r1.stream);
    await new Promise((r) => setTimeout(r, 0));
    const sdk = await import("@cursor/sdk");
    const agentsCount1 = (sdk as any).__agents.length;
    expect(agentsCount1).toBe(1);

    // turn 2 (プールヒット)
    const r2 = await m.doStream({
      prompt: [sys("S"), usr("U1"), { role: "assistant", content: [{ type: "text", text: "R1" }] }, usr("U2")],
    });
    await drain(r2.stream);
    expect((sdk as any).__agents.length).toBe(1);  // 新規生成されない
  });

  it("LRU 退避: 容量超過で最古 agent が close される", async () => {
    process.env.CURSOR_API_KEY = "test-key";
    const pool = createAgentPool({ log, capacity: 2 });
    const hook = createProviderHook({ resolveApiKey: async () => "test-key", log, pool });
    const models = await hook.models("cursor", ctx) as Map<string, any>;
    const m = models.get("composer-2")!;

    for (const u of ["U1", "U2", "U3"]) {
      await drain((await m.doStream({ prompt: [sys("S"), usr(u)] })).stream);
      await new Promise((r) => setTimeout(r, 0));
    }
    const sdk = await import("@cursor/sdk");
    const agents = (sdk as any).__agents;
    expect(agents[0][Symbol.asyncDispose]).toHaveBeenCalled();
  });

  it("キャンセル後の次ターンで前ターンと別 agent が生成される", async () => {
    process.env.CURSOR_API_KEY = "test-key";
    const pool = createAgentPool({ log, capacity: 8 });
    const hook = createProviderHook({ resolveApiKey: async () => "test-key", log, pool });
    const models = await hook.models("cursor", ctx) as Map<string, any>;
    const m = models.get("composer-2")!;

    const ac = new AbortController();
    const r1 = await m.doStream({ prompt: [sys("S"), usr("U1")], abortSignal: ac.signal });
    ac.abort();
    await drain(r1.stream);
    await new Promise((r) => setTimeout(r, 0));

    const sdk = await import("@cursor/sdk");
    const before = (sdk as any).__agents.length;
    const r2 = await m.doStream({
      prompt: [sys("S"), usr("U1"), { role: "assistant", content: [{ type: "text", text: "R1" }] }, usr("U2")],
    });
    await drain(r2.stream);
    expect((sdk as any).__agents.length).toBe(before + 1);
  });
});
```

- [ ] **Step 3: テスト実行・調整**

```bash
pnpm test -- tests/integration/provider-flow.test.ts
pnpm typecheck
```
Expected: PASS。

- [ ] **Step 4: コミット + Draft PR (→ Phase 4 base)**

```bash
git add tests/integration/provider-flow.test.ts
git commit -m "test(cursor-provider): エンドツーエンド統合テスト (5 シナリオ)"
git push -u origin feature/phase4-task1_integration-test
gh pr create --draft --base feature/phase4_release-prep__base \
  --title "test(cursor-provider): provider-flow 統合テスト" \
  --body "## Summary
- プールミス → put / ヒット / LRU 退避 / 退避後再ミス / キャンセル後の新規生成

## Test plan
- [ ] tests/integration/provider-flow.test.ts 全 PASS"
```

---

### Task 4.2: E2E 手動実行スクリプト

**派生元:** `feature/phase4_release-prep__base`（独立タスク）

**Files:**
- Create: `scripts/e2e-cursor-provider.sh`
- Modify: `package.json` (`scripts.test:e2e` 追加)

**コンテキスト:** 設計書 §8.6 / §10。実 Cursor API を叩く手動 E2E。CI からは除外する。

- [ ] **Step 1: ブランチ作成**

```bash
git checkout feature/phase4_release-prep__base
git checkout -b feature/phase4-task2_e2e-script
```

- [ ] **Step 2: スクリプト作成 (`scripts/e2e-cursor-provider.sh`)**

```bash
#!/usr/bin/env bash
set -euo pipefail
if [[ -z "${CURSOR_API_KEY:-}" ]]; then
  echo "ERROR: CURSOR_API_KEY が未設定です" >&2
  exit 1
fi
echo "[E2E] cursor-provider 手動 E2E"
echo "[Step 1] opencode.jsonc にプラグインパスが設定済みか確認してください:"
echo '  plugins: [["./.opencode/plugins/cursor-provider/index.ts", {}]]'
echo "[Step 2] opencode を起動 → /provider cursor → composer-2 を選択"
echo "[Step 3] 'Hello, what model are you?' を送信し、ストリーミング応答を確認"
echo "[Step 4] 連続 2 ターン目でプールヒット (debug ログ) を確認"
```

`package.json` の scripts に追加:
```json
"test:e2e": "bash scripts/e2e-cursor-provider.sh"
```

- [ ] **Step 3: chmod + コミット + Draft PR (→ Phase 4 base)**

```bash
chmod +x scripts/e2e-cursor-provider.sh
git add scripts/ package.json
git commit -m "chore(cursor-provider): 手動 E2E スクリプト追加 (CI 対象外)"
git push -u origin feature/phase4-task2_e2e-script
gh pr create --draft --base feature/phase4_release-prep__base \
  --title "chore(cursor-provider): 手動 E2E スクリプト" \
  --body "## Summary
- pnpm test:e2e で実 Cursor API への手動確認手順を表示

## Test plan
- [ ] CI には含めない
- [ ] devcontainer 内で bash scripts/e2e-cursor-provider.sh が実行可能"
```

---

### Task 4.3: ドキュメント更新 + バージョン bump 0.2.0

**派生元:** `feature/phase4_release-prep__base`（独立タスク）

**Files:**
- Modify: `README.md`
- Modify: `SPEC.md`（または設計書へのリンクに置換）
- Modify: `AGENTS.md`
- Modify: `package.json` (version: `0.2.0`)

**コンテキスト:** 設計書 §9。`cursor_prompt` 削除を破壊的変更として明記、`opencode auth login cursor` 利用方法、`opencode.jsonc` 設定例を追加。

- [ ] **Step 1: ブランチ作成**

```bash
git checkout feature/phase4_release-prep__base
git checkout -b feature/phase4-task3_docs-and-version
```

- [ ] **Step 2: README.md 更新**

冒頭の「v0.2.0 BREAKING CHANGE」セクションを追加し、以下を含める:

```md
## v0.2.0 (BREAKING CHANGE)
- 旧 `cursor_prompt` カスタムツールは削除されました
- Cursor は OpenCode のメイン LLM プロバイダーとして直接利用可能になりました

## 設定例 (`opencode.jsonc`)
\`\`\`jsonc
{
  "provider": { "default": "cursor/composer-2" },
  "plugins": [["./.opencode/plugins/cursor-provider/index.ts", {}]]
}
\`\`\`

## 認証
\`\`\`bash
opencode auth login cursor
# または環境変数
export CURSOR_API_KEY="..."
\`\`\`
```

- [ ] **Step 3: SPEC.md / AGENTS.md 更新**

`SPEC.md` の参照先を `docs/superpowers/specs/2026-05-03-cursor-provider-v2-design.md` に置換、または該当章を本書ベースに刷新。`AGENTS.md` の関連節を新設計書へのリンクに更新。

- [ ] **Step 4: package.json バージョン bump**

```bash
# version を 0.2.0 へ書き換え
```

- [ ] **Step 5: typecheck + 全テスト**

```bash
pnpm typecheck
pnpm test
```
Expected: PASS。

- [ ] **Step 6: コミット + Draft PR (→ Phase 4 base)**

```bash
git add README.md SPEC.md AGENTS.md package.json
git commit -m "docs(cursor-provider)!: v0.2.0 リリース準備 (BREAKING)"
git push -u origin feature/phase4-task3_docs-and-version
gh pr create --draft --base feature/phase4_release-prep__base \
  --title "docs(cursor-provider)!: v0.2.0 リリース準備" \
  --body "## Summary
- README に BREAKING CHANGE と設定例
- AGENTS.md / SPEC.md を新設計書へリンク
- package.json version 0.1.0 → 0.2.0

## Test plan
- [ ] pnpm typecheck / pnpm test 全 PASS"
```

---

### Phase 4 完了: Phase Draft PR

- [ ] **Step 1: Phase 4 内 PR を順次マージ** (Task 4.1 → 4.2 → 4.3)

- [ ] **Step 2: Phase 4 → master の Draft PR**

```bash
git checkout feature/phase4_release-prep__base
gh pr create --draft --base master \
  --title "release(cursor-provider): v0.2.0 (統合テスト + ドキュメント + E2E)" \
  --body "## Summary
- 統合テスト (5 シナリオ)
- 手動 E2E スクリプト (CI 対象外)
- README / AGENTS / SPEC を新設計書ベースに刷新
- package.json version 0.2.0

## Test plan
- [ ] devcontainer 内で pnpm typecheck 成功
- [ ] devcontainer 内で pnpm test 全 PASS
- [ ] CI 全 PASS"
```

> **マージ条件:** すべての Phase が CI 全 PASS でマージ済み。最後に Phase 4 をマージしてリリース完了。

---

## 全体テスト・検証チェックリスト（Devcontainer 内で実行）

各 Phase Draft PR の前に以下を必ず実行:

```bash
# Devcontainer 内であることを確認
echo $REMOTE_CONTAINERS  # true なら devcontainer 内
pnpm typecheck
pnpm test
# Phase 4 完了後のみ
pnpm test -- tests/integration/
```

---

## 設計書カバレッジ自己検証

| 設計書セクション | 対応 Task |
|---|---|
| §4 モジュール構成 (9 ファイル) | Phase 1〜3 全 Task |
| §5.1 translator 契約 | Task 1.3 |
| §5.2 agent-pool 契約 | Task 2.1 |
| §5.3 stream-proxy 契約 + 終端ガード | Task 3.1 |
| §5.4 provider 契約 | Task 3.2 |
| §5.5 auth 契約 + AuthHook | Task 2.2 |
| §5.6 logger | Task 1.1 |
| §5.7 errors + RetryPhase | Task 1.2 |
| §6.1〜6.2 データフロー (ヒット/ミス) | Task 3.2 + 4.1 |
| §6.3 起動時モデル解決 | Task 3.2 |
| §6.4 プロセス終了クリーンアップ + signal 再 raise | Task 3.3 |
| §7.1 SDK エラーマッピング | Task 1.2 + 3.1 |
| §7.2 run.wait() ステータス分岐 | Task 3.1 |
| §7.3 キャンセル経路 (pool.delete vs 直接 close) | Task 3.2 + 4.1 |
| §7.4 tool-call 警告 (toolCallId 単位 1 回) | Task 3.1 |
| §7.5 chat.params 初回警告 | Task 3.2 |
| §7.6 機微情報マスク | Task 1.1 + 1.2 |
| §8.2 単体テスト | Phase 1〜3 各 Task |
| §8.5 統合テスト (5 シナリオ) | Task 4.1 |
| §8.6 手動 E2E | Task 4.2 |
| §9 リリース・移行 | Task 4.3 |

---

## 実行ハンドオフ

**Plan complete and saved to `docs/superpowers/plans/2026-05-03-cursor-provider-v2-implementation.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - 各 Task ごとに新規 subagent を派遣、Task 間でレビュー、高速イテレーション

**2. Inline Execution** - 本セッション内で `superpowers:executing-plans` を用いてバッチ実行（チェックポイントレビュー付き）

**どちらの方式で進めますか？**
