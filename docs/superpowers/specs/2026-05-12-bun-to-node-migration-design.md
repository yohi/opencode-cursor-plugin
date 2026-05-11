# Bun → Node.js (>= 20) 完全移行 設計書

- **作成日:** 2026-05-12
- **対象リポジトリ:** `opencode-cursor-plugin`
- **対象ブランチ:** `master` 起点（実装は別ブランチを切る想定）
- **関連 PR/コミット:** PR #56 `fix/bun-crash-resolution`（マージ済み）以降の連続的なクラッシュ修正の最終フェーズ
- **要約:** Bun ランタイム下で頻発していた `sqlite3` ネイティブモジュール起因のセグメンテーションフォールト（0x13CB0）を、Node.js 20+ への運用統一と Agent ライフサイクル堅牢化により根本除去する。

---

## 1. 背景と現状分析

### 1.1 入力スコープのコンテキストとコードベース現状の不一致

タスク説明書では「現在 Bun 環境で実行されている」前提だが、コードベース精査の結果、ソースコード側の Bun 依存はすでに排除済みであることを確認した：

| 観点 | 期待される変更 | 実コードの現状 | 結論 |
|---|---|---|---|
| `Bun.serve` / `Bun.file` / `Bun.spawn` | Node 標準モジュールへ置換 | `grep -rn "Bun\." src/` → **0 件** | 完了済み |
| HTTP サーバ | `node:http` の `createServer` | `src/openai-proxy.ts:1, 332` で実装済み | 完了済み |
| ハッシュ計算 | `node:crypto` | `src/agent-pool.ts:1, 19` で実装済み | 完了済み |
| `package.json#engines` | `node >= 20` | 既に `"node": ">=20.0.0"` | 完了済み |
| `bun-types` 依存 | 削除 | `package.json` に存在せず、`@types/node ^20.14.0` のみ | 完了済み |
| `tsconfig.json#types` | `["node", "vitest/globals"]` | 既に設定済み | 完了済み |
| `vitest.config.ts` | `environment: "node"` | 既に設定済み | 完了済み |
| `.devcontainer/Dockerfile` | `mcr.microsoft.com/devcontainers/javascript-node:20` | `typescript-node@sha256:...`（Node 系だが別バリアント） | **要対応** |
| `Agent.create` 初期化オプション | `local: { cwd }` 明示 | 2 箇所とも `{ apiKey, model }` のみ | **要対応** |
| `POOL_CAPACITY` | `10` | `src/index.ts:11` で `8` | **要対応** |
| `disposeAgentSafely` のアイドル確認 | 実装あり | grace delay なし、リトライなし | **要対応** |

### 1.2 直近のクラッシュ修正履歴（参考）

```text
081f9c6 fix: use cloud agent execution to prevent native module segfaults
876ead0 fix(sdk): Bun でのクラッシュ回避のため Agent.create から cloud: {} を削除し、再試行ロジックを強化
9f50b9c fix(provider): Bun 環境でタイマー関数が正しく動作しない問題を修正
a877f4c fix: pin @cursor/sdk to 1.0.10 to prevent sqlite3 segfault in Bun
```

これらの修正は Bun 環境下での迂回策が中心であり、本設計は **Node.js 20+ への運用統一**と **`local: { cwd }` 明示**によって、ネイティブ側の不確定性の根本要因を排除することを目的とする。

---

## 2. ゴールと非ゴール

### 2.1 ゴール

1. Devcontainer を Node.js 20 系の標準イメージへ切替え、`pnpm test` / `pnpm typecheck` / `pnpm lint` がコンテナ内で再現的に動作することを保証する。
2. `Agent.create` の初期化オプションを `local: { cwd: process.cwd() }` で明示し、ネイティブモジュール（`sqlite3`）のワーキングディレクトリ解決をデフォルト動作に依存させない。
3. AgentPool の容量と破棄ロジックを調整し、`sqlite3` 由来の dispose レースを回避する。
4. テストおよび静的解析が Devcontainer 内で実行されることを README / AGENTS.md に明文化する。

### 2.2 非ゴール

- `@cursor/sdk` 自体のバージョン更新（現行 `1.0.12` を維持）。
- Bun 互換性の維持（Bun を意図的に切り捨て、Node 20+ 専用とする）。
- 既存テストの拡張・新規テスト群の整備（変更影響範囲の最小限のテスト更新は実施）。
- プロバイダ層やストリーミング処理（`stream-proxy.ts`）のアーキテクチャ変更。

---

## 3. アーキテクチャ概要

### 3.1 変更対象ファイル一覧

```text
modified:
  .devcontainer/Dockerfile              base image: typescript-node → javascript-node:20
  .devcontainer/devcontainer.json       postCreateCommand 強化、extensions/settings の整理
  package.json                          devDependencies に @biomejs/biome 追加、scripts に "lint" 追加
  src/index.ts                          POOL_CAPACITY 8 → 10
  src/agent-cleanup.ts                  dispose 失敗時の 1 回リトライ追加
  src/openai-proxy.ts                   Agent.create に local: { cwd } 追加（PoC で受理確認後）
  src/provider.ts                       同上（Agent.create 厳格化）
  AGENTS.md                             commands セクションに「Devcontainer 内必須」を明記
  README.md                             同上の利用者向け追記
unchanged:
  src/agent-pool.ts                     現行 PooledAgent インターフェイス・tryGet/put ロジックを維持
  src/auth.ts, config.ts, errors.ts, git.ts, logger.ts, models.ts,
  src/pkce.ts, src/stream-proxy.ts, src/translator.ts
  tsconfig.json, vitest.config.ts, biome.json
test updates (minimal):
  tests/agent-cleanup.test.ts           dispose リトライの単体テスト追加
```

### 3.2 破棄パスのデータフロー

`disposeAgentSafely` は **必ず agent の進行中処理（`agent.send` → `run.wait()`）が完了した後**に呼び出される。これは現行コードの全呼び出し箇所で既に成立している不変量である：

- `src/openai-proxy.ts:247, 257, 307, 319` — いずれも `run.wait()` の解決 / 拒否を await した後の経路。
- `src/provider.ts:221`（`handleStreamFinish`） — `done` Promise が解決した後に呼ばれる。
- `src/provider.ts:285`（`recreateAgent`） — UnknownAgentError 検出時、既存 agent の参照を切る前に呼ぶ。
- `src/agent-pool.ts` の `evictIfNeeded` / displaced / `closeAll` — いずれも map 内のエントリ（= 過去に `pool.put` で戻された idle なエントリ）に対してのみ動作。

したがって呼び出し側責務として「アクティブな Promise の解決を待つ」ことを徹底すれば、`disposeAgentSafely` 自体は agent の状態を内省する必要はない。

```text
[呼び出し側で agent.send / run.wait の解決を await 済み]
  └─> disposeAgentSafely(agent)
        └─> callAsyncDispose(agent)            ← 1 回目
              ├─> "ok"     → 終了
              ├─> "timeout" → log.warn のみで終了
              │                （リトライしない: native ロック保持中の二重解放を回避）
              └─> throw     → catch 経路へ
                              ├─> sleep(RETRY_DELAY_MS=200ms)
                              ├─> callAsyncDispose(agent)  ← 2 回目（最終、catch のみ）
                              └─> 失敗 → log.warn のみで握り潰し（プロセスは継続）
```

### 3.3 実装前 PoC ゲート（必須）

`local: { cwd: process.cwd() }` は `@cursor/sdk@1.0.12` の公開型定義（`.d.ts`）に**現時点では含まれていない undocumented option** である。これをアーキテクチャの前提に置く前に、以下の PoC を必須ゲートとして実施し、結果に応じて実装方針を分岐させる。

**PoC 手順：**

1. 実装ブランチを切る前に、Devcontainer（本設計の Node 20 イメージ）内で以下のスクリプトを実行する：

   ```ts
   // scripts/poc-agent-local-mode.ts
   import { Agent } from "@cursor/sdk";

   const apiKey = process.env.CURSOR_API_KEY;
   if (!apiKey) throw new Error("CURSOR_API_KEY required");

   // @ts-expect-error local オプションは現行 .d.ts に未公開
   const agent = await Agent.create({
     apiKey,
     model: { id: "composer-2" },
     local: { cwd: process.cwd() },
   });

   const run = await agent.send("ping", { onDelta: () => {} });
   const result = await run.wait();
   console.log("STATUS=", result.status);
   await agent[Symbol.asyncDispose]();
   ```

2. 判定基準：
   - **成功:** `STATUS=finished` が出力され、プロセスが segfault せず正常終了。`@cursor/sdk` のソースまたは dist に `local` 受理コードが確認できる。→ **設計を本書のまま採用**。
   - **失敗（型・ランタイムどちらでも）:** Agent.create が throw する／引数バリデーションで弾かれる／native crash が再現する。→ **フォールバック設計に切替**。

3. PoC 結果は実装 PR の説明欄に添付（コンソールログまたはスクリーンショット）。レビュアはこのエビデンスをマージ条件とする。

**フォールバック設計（PoC 失敗時）:**

| 項目 | 主案（PoC 成功時） | フォールバック（PoC 失敗時） |
|---|---|---|
| `Agent.create` 引数 | `{ apiKey, model: { id }, local: { cwd: process.cwd() } }` | `{ apiKey, model: { id } }` のみ（現状維持。PR #56 マージ後の既知良好状態） |
| 型定義 | `AgentCreateOpts` を本書 §4.7 のとおり拡張 | 既存の `{ apiKey: string; model: { id: string } }` を維持 |
| 移行サマリーの記述 | 「local モードを明示し、ネイティブ側 cwd 解決を堅牢化」 | 「SDK デフォルト挙動を維持。`local` 明示は `@cursor/sdk` の公式型サポート待ち」と注記 |
| 残課題 | なし（実装で完結） | `tests/integration/` 配下に `local` オプション受理を検出する回帰検知テストを追加し、SDK アップデート時に PoC を再実施 |

このフォールバックは constraint 2 を後退させるように見えるが、constraint 5（不確実性のルール）の優先度が上位にあるため、未確認仕様で破壊的変更を強行しないことを優先する。フォールバック採用時は本設計書末尾の §9「出力フォーマット」の「移行サマリー」欄でその旨を明示する。

---

## 4. 詳細設計

### 4.1 Devcontainer

**Dockerfile:**

```dockerfile
FROM mcr.microsoft.com/devcontainers/javascript-node:20

RUN corepack enable \
 && corepack prepare pnpm@9.12.0 --activate \
 && [ "$(pnpm --version)" = "9.12.0" ] \
 && node --version | grep -E '^v20\.' >/dev/null

USER node
```

> [!NOTE]
> Dockerfile 内の pnpm バージョンは、必ず `package.json` の `packageManager` フィールドと一致させてください。

**devcontainer.json:**

```jsonc
{
  "name": "opencode-cursor-plugin",
  "build": { "dockerfile": "Dockerfile" },
  "remoteEnv": {
    "CURSOR_API_KEY": "${localEnv:CURSOR_API_KEY}"
  },
  "postCreateCommand": "node -e \"if(parseInt(process.versions.node) < 20){process.exit(1)}\" && pnpm install --frozen-lockfile",
  "customizations": {
    "vscode": {
      "extensions": ["biomejs.biome", "vitest.explorer"],
      "settings": {
        "editor.formatOnSave": true,
        "editor.defaultFormatter": "biomejs.biome",
        "typescript.tsdk": "node_modules/typescript/lib"
      }
    }
  }
}
```

**確認が必要な事項:**
- 既存 CI（`bitbucket-pipelines.yml` または GitHub Actions）が Node 20 で走っていることの整合性確認。本設計の対象外だが、PR レビュー時にチェックする。

### 4.2 package.json の差分

```jsonc
{
  "scripts": {
    "build": "tsc --project tsconfig.json --outDir dist --noEmit false",
    "prepublishOnly": "pnpm build",
    "typecheck": "tsc --noEmit",
    "lint": "biome ci .",          // ← 追加
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "bash scripts/e2e-cursor-provider.sh"
  },
  "devDependencies": {
    "@biomejs/biome": "^1.9.4",    // ← 追加（biome.json 既存）
    "@opencode-ai/plugin": "^1.14.30",
    "@types/node": "^20.14.0",
    "typescript": "^5.5.0",
    "vitest": "^1.6.0"
  }
}
```

`dependencies` / `engines` / `peerDependencies` / `pnpm.overrides` は変更なし。

### 4.3 `src/index.ts`

```ts
const POOL_CAPACITY = 10;  // was: 8 — Node 20 環境下で生成・破棄サイクルを緩和し、sqlite3 dispose 競合を抑制
```

その他のロジックは変更なし。

### 4.4 `src/agent-pool.ts`

**変更なし。** 現行の `PooledAgent` インターフェイスと `tryGet` / `put` / `evictIfNeeded` / `closeAll` のロジックをそのまま維持する。

理由：本設計初版で検討した `inFlight` カウンタ＋`waitUntilIdle` ポーリングは過剰設計だった。`disposeAgentSafely` は呼び出し側がアクティブ Promise の解決を await した後にのみ呼び出される（§3.2 で根拠を列挙）ため、ライブラリ側で agent 状態を内省する必要はない。アイドル保証は呼び出し側の責務として既存コードで満たされている。

### 4.5 `src/agent-cleanup.ts`

呼び出し側でアクティブ Promise の解決を待つ責務はすでに守られている（§3.2）ため、ここでは **例外（catch）経路でのみ 1 度リトライし、タイムアウト経路ではリトライせず警告ログのみで終了する** 非対称設計を採用する。

**設計判断の根拠:**
- **タイムアウト（`Promise.race` で `"timeout"` 解決）:** `[Symbol.asyncDispose]()` の戻り Promise は依然として pending である。すなわち native 側（`sqlite3` を含む）は close 処理を進行中またはロック保持中の可能性が高い。この状態で再度 `[Symbol.asyncDispose]()` を呼ぶと、同一ハンドルに対する二重 close を発行し、`sqlite3` で **double-free / use-after-free** を引き起こすリスクが高い。よってリトライは行わない。
- **例外（`callAsyncDispose` が throw）:** 戻り Promise は reject により**確定的に決着**している。SDK 側の dispose 呼び出し境界が閉じているため、grace delay を挟んでの再呼び出しは安全。

```ts
import type { SDKAgent } from "@cursor/sdk";
import type { Logger } from "./logger.js";

export const DISPOSE_TIMEOUT_MS = 5_000;
export const RETRY_DELAY_MS = 200;

async function callAsyncDispose(agent: SDKAgent): Promise<"ok" | "timeout"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), DISPOSE_TIMEOUT_MS);
  });
  try {
    // Symbol.asyncDispose はブラケット記法必須（言語仕様）。
    // skip-codacy
    const disposePromise = agent[Symbol.asyncDispose]().then(() => "ok" as const);
    disposePromise.catch(() => {}); // 遅延 reject の UnhandledPromiseRejection を抑制
    return await Promise.race([disposePromise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function disposeAgentSafely(agent: SDKAgent, log: Logger): Promise<void> {
  try {
    const result = await callAsyncDispose(agent);
    if (result === "timeout") {
      // NOTE: タイムアウト時はネイティブ側（sqlite3 など）がロック保持・close 進行中の可能性が
      // 高く、再度 [Symbol.asyncDispose]() を呼ぶと二重解放 / use-after-free を誘発しうる。
      // よってリトライせず、警告ログのみで握り潰す（プロセスは継続）。
      log.warn("cursor-provider: agent dispose timed out; not retrying (native lock risk)", {
        timeoutMs: DISPOSE_TIMEOUT_MS,
      });
    }
  } catch (err) {
    // 例外で reject された場合は dispose 呼び出しが確定的に決着しているため、
    // 200ms 待機後に 1 度だけ再試行する。
    log.warn("cursor-provider: agent dispose failed; retrying once", {
      errorType: err instanceof Error ? err.constructor.name : typeof err,
    });
    try {
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      const retryResult = await callAsyncDispose(agent);
      if (retryResult === "timeout") {
        log.warn("cursor-provider: agent dispose retry timed out; native lock remains a risk", {
          timeoutMs: DISPOSE_TIMEOUT_MS,
        });
      }
    } catch (retryErr) {
      log.warn("cursor-provider: agent dispose retry failed; suppressing to prevent process crash", {
        errorType: retryErr instanceof Error ? retryErr.constructor.name : typeof retryErr,
      });
    }
  }
}
```

呼び出し側に対する追加要件：すでに全箇所で満たされているが、保守時の不変量として明示する。
- `disposeAgentSafely(agent)` を呼ぶ前に、その agent に対して開始した `agent.send(...)` / `run.wait()` Promise の `await`（解決でも拒否でも）が完了していること。
- プール経由で取り扱う agent（`pool.tryGet` 取得後 → `pool.put` 戻し）については、`pool.put` 後にプール内エントリは idle 不変量を満たすため、追加配慮は不要。

### 4.6 `src/openai-proxy.ts`

PoC（§3.3）が成功した場合のみ、`Agent.create` 呼び出し（line 162-165 付近）を以下に置換する：

```ts
// NOTE: Node.js 移行に伴い、@cursor/sdk の Agent.create には実行モードを明示的に指定する。
// 履歴: 081f9c6 で cloud 実行に切替 → 876ead0 で空 cloud:{} を削除（Bun 互換性問題）。
// 現在は Node 20 環境で local モードに固定し、cwd を明示することでネイティブモジュール
// (sqlite3) のワーキングディレクトリ解決を堅牢化する。
//
// 採用前に §3.3 の PoC で @cursor/sdk が "local: { cwd }" を受理することを確認済み
// （@cursor/sdk@1.0.12 時点では undocumented option）。SDK アップデート時に再確認が必要。
agent = await Agent.create({
  apiKey,
  model: { id: modelId },
  local: { cwd: process.cwd() },
});
```

`pool.put` の呼び出しは現状維持（`inFlight` フィールド追加は廃案）。

### 4.7 `src/provider.ts`

PoC（§3.3）が成功した場合のみ、`performAgentCreationAttempt` の型と呼び出し（line 316-325 付近）を `local` を含む形に拡張する：

```ts
type AgentCreateOpts = {
  apiKey: string;
  model: { id: string };
  local: { cwd: string };
};

async function performAgentCreationAttempt(deps: {
  Agent: { create: (opts: AgentCreateOpts) => Promise<unknown> };
  apiKey: string;
  modelId: string;
  log: Logger;
  attempt: number;
}): Promise<{ agent: SDKAgent } | { error: unknown; canRetry: boolean; delay: number }> {
  const { Agent, apiKey, modelId, log, attempt } = deps;
  try {
    log.debug("cursor-provider: calling Agent.create", { modelId, attempt });
    // NOTE: 詳細は src/openai-proxy.ts の同等コメント参照。
    const agent = (await Agent.create({
      apiKey,
      model: { id: modelId },
      local: { cwd: process.cwd() },
    })) as SDKAgent;
    return { agent };
  } catch (err) {
    /* unchanged */
  }
}
```

`createAgentWithRetry`（line 340 付近）の `Agent` キャストも `AgentCreateOpts` 互換に揃える。

`handleStreamFinish` 内 `pool.put` 呼び出しは現状維持（`inFlight` 追加は廃案）。

### 4.8 AGENTS.md / README.md

`AGENTS.md` の `<commands>` セクションを「Ideally, these should be run inside the provided Devcontainer」→「**Required:** these MUST be run inside the provided Devcontainer (`.devcontainer/`) for native module (`sqlite3`) reproducibility.」に修正。

`README.md` の開発者向けセクションにも同等の注記を追加。

### 4.9 Bun API → Node API 置換（現状追認）

| 旧 Bun API | 置換先 | 実装状態 |
|---|---|---|
| `Bun.serve(...)` | `http.createServer(...).listen(0, "127.0.0.1")` | `src/openai-proxy.ts:332-379` で実装済み |
| `Bun.file(...).text()` | `fs/promises.readFile(path, "utf8")` | 該当箇所なし |
| `Bun.spawn(...)` | `node:child_process.spawn` | 該当箇所なし |
| `Bun.hash(...)` / `Bun.SHA256` | `node:crypto.createHash("sha256")` | `src/agent-pool.ts:19` で実装済み |
| `Bun.env` | `process.env` | 全コードで `process.env` 使用済み |
| Bun のタイマー | `node:timers` / `node:timers/promises` | `src/provider.ts:3` で `node:timers/promises` 使用済み |

**結論:** ソースコード側に Bun 固有 API は残存していない。本設計では現状を追認し、デグレ防止のために Biome / TSC を Devcontainer 内で実行する運用に揃える。

---

## 5. エラーハンドリング

### 5.1 Dispose 失敗時のフォールバック挙動

`disposeAgentSafely` は以下のいずれの最終状態に至っても、ログ警告のみでプロセスは継続させる：

- 1 回目 `callAsyncDispose` がタイムアウト → リトライせず警告ログのみ
- 1 回目 `callAsyncDispose` が throw → 200ms 待機後に 1 度リトライ → リトライも throw

これは Bun 環境下で発生していた未捕捉例外によるプロセスクラッシュを根本的に防ぐため。Node 20+ 下でも `sqlite3` の close 順序によって稀に native exception が浮上する可能性があるが、Logger による可観測性を確保した上で握り潰す方針。

### 5.2 Dispose リトライの遅延（catch 経路のみ）

`RETRY_DELAY_MS=200ms`。**catch 経路でのみ適用**する。1 回目の `Symbol.asyncDispose` が throw した直後に即時リトライすると、native 側の状態（sqlite3 のロックなど）がまだ未解放の可能性があるため、200ms の grace を入れてから 2 回目を試みる。意図：定常的な race を避けつつ、ユーザ体感に影響しない長さに抑える。

タイムアウト経路では本 grace は適用されない（§4.5 の設計判断根拠を参照）。

### 5.3 `Agent.create` リトライ

既存実装の最大 3 回・指数バックオフ（`classifyError` の retry 判定）は維持。

---

## 6. テスト計画

### 6.1 単体テスト

| 対象 | 更新内容 |
|---|---|
| `tests/agent-pool.test.ts` | 変更なし（`PooledAgent` の構造変更を廃止したため） |
| `tests/agent-cleanup.test.ts` | (a) 1 回目タイムアウト時は **リトライせず**、`"agent dispose timed out; not retrying (native lock risk)"` の警告ログを 1 回だけ出力して関数が解決すること（`callAsyncDispose` のモック呼び出し回数が 1 回であることをアサート）／ (b) 1 回目 throw → 200ms 待機後にリトライ成功 ／ (c) catch 経路でリトライも throw した場合に警告ログのみで例外伝播しないこと、を追加 |
| `tests/provider.test.ts` | PoC 成功時のみ `Agent.create` モックが `local: { cwd }` を含む引数で呼ばれることを検証（PoC 失敗・フォールバック採用時は本テスト追加を行わない） |

### 6.2 統合テスト

`tests/integration/provider-flow.test.ts` は現状の挙動を維持するスモークテストとして利用。PoC 成功時はモック側で `local` を受理するよう調整、PoC 失敗時は調整不要。

### 6.3 検証コマンド（Devcontainer 内で実行）

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
```

すべて成功することをマージ条件とする。

---

## 7. ロールアウトとリスク

### 7.1 ロールアウト

1. 別ブランチ `chore/node-20-migration-finalize` を作成。
2. **最初のコミットで §3.3 の PoC を実行**。`scripts/poc-agent-local-mode.ts` を一時的に追加して Devcontainer 内で実行し、結果（成功 / 失敗）を判定。
3. PoC 成功 → 本書 §4 の主案を実装。PoC 失敗 → §3.3 フォールバック設計に切替えて実装（`local` 追加を除いた変更のみ適用）。
4. PoC スクリプトはコミットせずに削除する（実装本体に含めない）。エビデンスは PR 説明欄に転記。
5. PR を作成し、Devcontainer 内での `pnpm test` / `pnpm typecheck` / `pnpm lint` 成功ログを添付。
6. レビュー後、`master` へマージ。

### 7.2 リスクと緩和策

| リスク | 影響 | 緩和策 |
|---|---|---|
| `local: { cwd }` が `@cursor/sdk@1.0.12` の型にもランタイムにも未対応 | 主案不採用 | §3.3 の PoC ゲートで実装着手前に検証。失敗時は同節のフォールバック設計（オプション無指定）に自動切替 |
| PoC 成功後に SDK アップデートで `local` 受理が削除される | 将来的なクラッシュ復活 | `tests/integration/` 配下にスモークテストを残し、CI で検出。`@cursor/sdk` のアップグレード時に §3.3 PoC を再実施する旨を `CHANGELOG.md` または `AGENTS.md` の保守メモに残す |
| Devcontainer イメージ変更で既存ユーザのコンテナビルドが壊れる | DX 影響 | README / AGENTS.md に「コンテナを再ビルドしてください」と明記。`postCreateCommand` で Node バージョンをフェイルファスト検証 |
| `disposeAgentSafely` のリトライ握り潰しでメモリリーク | プロセス長期稼働で蓄積 | OpenCode プロセスのライフサイクルは比較的短く、累積リスクは低い。Logger で件数を可視化 |

---

## 8. 未確認事項（実装着手前に要確認）

1. `@cursor/sdk@1.0.12` の `Agent.create` が `local: { cwd: string }` オプションを受理することは、**§3.3 PoC ゲートで実装第一歩として検証する**（本書では未確認のまま着手しない）。
2. CI 環境（Bitbucket Pipelines 想定）の Node バージョンが 20 以上であること。
3. AGENTS.md の `<documentation_map>` で参照されている `SPEC.md` に Devcontainer 必須化を反映すべきか判断（本設計の範囲外）。

---

## 9. 出力フォーマット（実装後の deliverable）

実装完了時には、依頼の `<output_format>` に沿った以下の構成で成果物を提示する：

1. 移行サマリー
2. Devcontainer 環境の更新コード（Dockerfile / devcontainer.json）
3. パッケージと設定の更新（package.json 差分）
4. コアロジックのリファクタリング（`src/openai-proxy.ts`, `src/agent-cleanup.ts`, `src/provider.ts`, `src/index.ts`。`src/agent-pool.ts` は本書改訂により変更対象から外れたため「現状追認」と明記）
5. Bun API の置換に関する現状追認（差分なし）
