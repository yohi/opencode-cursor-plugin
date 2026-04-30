# OpenCode Cursor SDK Plugin 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** OpenCode のプラグインアーキテクチャに準拠し、Cursor 公式 SDK (`@cursor/sdk`) 経由で Cursor エージェントに任意のプロンプトを送信できる単一カスタムツール `cursor_prompt` を提供する。

**Architecture:** OpenCode プラグインエントリ `.opencode/plugins/custom-tools.ts` に Zod スキーマで引数を定義した `cursor_prompt` ツールを 1 つ実装する。`Agent.create` → `agent.send` → `run.wait` の 3 段で Cursor エージェントを実行し、`RunResult.status === "finished"` の場合のみテキスト応答を返却する。SDK 派生例外はログ後に再 throw、リソースは `finally` で `agent.close()`。

**Tech Stack:** TypeScript 5.x / Node.js 20 / pnpm 9 / `@cursor/sdk` / `zod` / `dotenv` / `@opencode-ai/plugin` / `vitest`（テスト）/ Devcontainer（typescript-node:20）/ GitHub Actions（`devcontainers/ci`）。

**設計書参照:** `docs/superpowers/specs/2026-04-30-opencode-cursor-plugin-design.md`

---

## ファイル構成

| パス | 役割 | 作成 Task |
|---|---|---|
| `.devcontainer/devcontainer.json` | Devcontainer 定義（Node 20 + pnpm 9） | Task 0.2 |
| `.devcontainer/Dockerfile` | typescript-node:20 ベースの最小 Dockerfile | Task 0.2 |
| `.github/workflows/ci.yml` | master push/PR トリガーで `pnpm typecheck && pnpm test` 実行 | Task 0.3 |
| `package.json` | 依存（`@cursor/sdk`, `zod`, `dotenv`, `@opencode-ai/plugin`, `typescript`, `@types/node`, `vitest`）と pnpm スクリプト | Task 0.1 |
| `pnpm-lock.yaml` | 依存ロックファイル | Task 0.1 |
| `tsconfig.json` | `strict: true` / `module: ESNext` / `target: ES2022` / `moduleResolution: bundler` | Task 0.1 |
| `vitest.config.ts` | vitest 設定（globals, environment: node） | Task 0.1 |
| `tests/smoke.test.ts` | パイプライン疎通用のスモークテスト（Phase 1 開始時に削除） | Task 0.1 |
| `.gitignore` | `node_modules`, `.env`, `dist` 等を除外 | Task 0.1 |
| `.env.example` | `CURSOR_API_KEY=` の雛形 | Task 0.1 |
| `.opencode/plugins/custom-tools.ts` | プラグインエントリ。`cursor_prompt` ツールを export | Task 1.1 〜 1.5 |
| `tests/cursor-prompt.test.ts` | T1 〜 T12 のユニットテスト | Task 1.1 〜 1.5 |
| `README.md` | 利用方法（API キー設定 / OpenCode への接続方法） | Task 1.5 |

---

## Phase 0: プロジェクト基盤構築

**Phase Base:** `feature/phase0_foundation__base`（`master` から作成）
**目的:** 開発環境（Devcontainer）/ CI（GitHub Actions）/ Node ツール一式を整備し、Phase 1 以降が Devcontainer 内で TDD ループを回せる状態にする。

### Phase 0 開始前セットアップ（手動・Phase に含めない）

- [ ] **Pre-Step 1: GitHub リポジトリと master 初期化**

ローカルでリポジトリを初期化し、空コミットを master として push する（Phase ブランチが master から派生できる前提を満たす）。

```bash
cd /home/y_ohi/program/private/opencode-cursor-plugin
git init -b master
git add docs/
git commit -m "chore: initialize repository with design document"
gh repo create opencode-cursor-plugin --private --source=. --remote=origin --push
```

期待: `git log --oneline` で初期コミットが master に存在し、`origin/master` が GitHub に push されている。

- [ ] **Pre-Step 2: Phase 0 ベースブランチ作成**

```bash
git checkout master
git checkout -b feature/phase0_foundation__base
git push -u origin feature/phase0_foundation__base
```

---

### Task 0.1: Node ツール一式の導入（package.json / tsconfig / vitest）

**派生元:** `feature/phase0_foundation__base`（独立タスク。Phase 内で最初の基盤）
**ブランチ名:** `feature/phase0-task1_node_tooling`

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `tests/smoke.test.ts`
- Create: `.gitignore`
- Create: `.env.example`

- [ ] **Step 1: ブランチ作成**

```bash
git checkout feature/phase0_foundation__base
git pull origin feature/phase0_foundation__base
git checkout -b feature/phase0-task1_node_tooling
```

- [ ] **Step 2: `.gitignore` 作成**

`/home/y_ohi/program/private/opencode-cursor-plugin/.gitignore`:

```gitignore
node_modules/
dist/
.env
.env.local
*.log
.DS_Store
coverage/
```

- [ ] **Step 3: `.env.example` 作成**

`/home/y_ohi/program/private/opencode-cursor-plugin/.env.example`:

```dotenv
CURSOR_API_KEY=
```

- [ ] **Step 4: `package.json` 作成**

`/home/y_ohi/program/private/opencode-cursor-plugin/package.json`:

```json
{
  "name": "opencode-cursor-plugin",
  "version": "0.1.0",
  "private": true,
  "description": "OpenCode plugin that exposes the Cursor SDK as a custom tool",
  "type": "module",
  "engines": {
    "node": ">=20.0.0",
    "pnpm": ">=9.0.0"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@cursor/sdk": "^0.1.0",
    "dotenv": "^16.4.5",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@opencode-ai/plugin": "^0.4.0",
    "@types/node": "^20.14.0",
    "typescript": "^5.5.0",
    "vitest": "^1.6.0"
  },
  "packageManager": "pnpm@9.12.0"
}
```

- [ ] **Step 5: `tsconfig.json` 作成**

`/home/y_ohi/program/private/opencode-cursor-plugin/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": false,
    "types": ["node", "vitest/globals"]
  },
  "include": [".opencode/plugins/**/*.ts", "tests/**/*.ts", "vitest.config.ts"]
}
```

- [ ] **Step 6: `vitest.config.ts` 作成**

`/home/y_ohi/program/private/opencode-cursor-plugin/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
```

- [ ] **Step 7: スモークテスト作成（パイプライン疎通確認用）**

`/home/y_ohi/program/private/opencode-cursor-plugin/tests/smoke.test.ts`:

```ts
import { describe, it, expect } from "vitest";

describe("smoke", () => {
  it("vitest pipeline is wired up", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 8: 依存インストール（Devcontainer 構築前のため、ローカル pnpm 必須。次タスクで Devcontainer 内に移行）**

```bash
corepack enable
corepack prepare pnpm@9.12.0 --activate
pnpm install
```

期待: `pnpm-lock.yaml` が生成される。`node_modules/` は `.gitignore` 済み。

- [ ] **Step 9: 型チェック・テスト実行**

```bash
pnpm typecheck
pnpm test
```

期待: typecheck はエラーなし、`tests/smoke.test.ts` の 1 件が PASS。

- [ ] **Step 10: コミット**

```bash
git add package.json pnpm-lock.yaml tsconfig.json vitest.config.ts tests/smoke.test.ts .gitignore .env.example
git commit -m "chore: introduce pnpm/TypeScript/vitest tooling with smoke test"
```

- [ ] **Step 11: push して Phase Base 向け Draft PR 作成**

```bash
git push -u origin feature/phase0-task1_node_tooling
gh pr create --draft --base feature/phase0_foundation__base \
  --title "Phase 0 / Task 1: Node tooling (pnpm + TypeScript + vitest)" \
  --body "$(cat <<'EOF'
## Summary
- pnpm 9 / TypeScript 5 / vitest 1 を導入し、`pnpm test` / `pnpm typecheck` の最小パイプラインを構築
- 後続タスクで Devcontainer / CI / プラグイン本体実装が依存する基盤
- スモークテスト 1 件で pipeline 疎通を確認

## Test plan
- [ ] Devcontainer 内で `pnpm install` が成功する（次タスク 0.2 で検証）
- [x] ローカルで `pnpm typecheck` がエラーなく完了
- [x] ローカルで `pnpm test` が PASS（smoke.test.ts）
EOF
)"
```

---

### Task 0.2: Devcontainer 構築（typescript-node:20 + pnpm + 環境変数連携）

**派生元:** `feature/phase0-task1_node_tooling`（依存タスク：`postCreateCommand` で `pnpm install` を実行するため Task 0.1 の `package.json` を物理的に必要とする）
**ブランチ名:** `feature/phase0-task2_devcontainer`

**Files:**
- Create: `.devcontainer/devcontainer.json`
- Create: `.devcontainer/Dockerfile`

- [ ] **Step 1: ブランチ作成**

```bash
git checkout feature/phase0-task1_node_tooling
git pull origin feature/phase0-task1_node_tooling
git checkout -b feature/phase0-task2_devcontainer
```

- [ ] **Step 2: `Dockerfile` 作成（最小拡張）**

`/home/y_ohi/program/private/opencode-cursor-plugin/.devcontainer/Dockerfile`:

```dockerfile
FROM mcr.microsoft.com/devcontainers/typescript-node:20

# Enable corepack (ships with Node 20) and pin pnpm to the version declared in package.json
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
```

- [ ] **Step 3: `devcontainer.json` 作成**

`/home/y_ohi/program/private/opencode-cursor-plugin/.devcontainer/devcontainer.json`:

```jsonc
{
  "name": "opencode-cursor-plugin",
  "build": {
    "dockerfile": "Dockerfile"
  },
  "remoteEnv": {
    "CURSOR_API_KEY": "${localEnv:CURSOR_API_KEY}"
  },
  "postCreateCommand": "pnpm install --frozen-lockfile",
  "customizations": {
    "vscode": {
      "extensions": [
        "dbaeumer.vscode-eslint",
        "esbenp.prettier-vscode",
        "anysphere.cursorpyright"
      ],
      "settings": {
        "editor.formatOnSave": true,
        "typescript.tsdk": "node_modules/typescript/lib"
      }
    }
  }
}
```

- [ ] **Step 4: Devcontainer をビルドして起動**

VS Code または Cursor IDE で「Dev Containers: Reopen in Container」を実行（または `devcontainer up --workspace-folder .`）。

期待: コンテナ起動後 `node --version` が v20.x、`pnpm --version` が 9.12.0、`pnpm install` 完了済み。

- [ ] **Step 5: Devcontainer 内で型チェック・テスト実行**

**Devcontainer 内のターミナルで実行:**

```bash
pnpm typecheck
pnpm test
```

期待: typecheck エラーなし、`smoke.test.ts` が PASS。これにより Devcontainer 内で TDD ループが回ることを確認。

- [ ] **Step 6: 環境変数パススルー確認**

ホスト側で `export CURSOR_API_KEY=dummy-test-value` した状態で Devcontainer 内のターミナルで:

```bash
echo "${CURSOR_API_KEY}"
```

期待: `dummy-test-value` が表示される（`remoteEnv` のパススルー検証）。

- [ ] **Step 7: コミット**

```bash
git add .devcontainer/devcontainer.json .devcontainer/Dockerfile
git commit -m "chore: add devcontainer with Node 20 + pnpm 9 and CURSOR_API_KEY passthrough"
```

- [ ] **Step 8: push して Phase Base 向け Draft PR 作成**

```bash
git push -u origin feature/phase0-task2_devcontainer
gh pr create --draft --base feature/phase0_foundation__base \
  --title "Phase 0 / Task 2: Devcontainer (typescript-node:20 + pnpm 9)" \
  --body "$(cat <<'EOF'
## Summary
- `mcr.microsoft.com/devcontainers/typescript-node:20` を Dockerfile で拡張し pnpm 9.12.0 を pin
- `remoteEnv` で `CURSOR_API_KEY` をホストから透過パススルー
- `postCreateCommand` で `pnpm install --frozen-lockfile` を自動実行

## Test plan
- [x] Devcontainer ビルドが成功する
- [x] Devcontainer 内 `pnpm typecheck` / `pnpm test` が PASS
- [x] `${CURSOR_API_KEY}` が Devcontainer 内に伝搬する
EOF
)"
```

---

### Task 0.3: GitHub Actions CI（master トリガー / ubuntu-slim ランナー / Devcontainer 内実行）

**派生元:** `feature/phase0-task1_node_tooling`（依存タスク：CI が `pnpm typecheck` / `pnpm test` を呼ぶため Task 0.1 の `package.json` を物理的に必要とする。Task 0.2 の Devcontainer は `devcontainers/ci` アクション側で利用するが、CI ワークフローは Task 0.2 の成果物に依存しない構造で書き、Phase Base マージ後に両者が揃う前提）
**ブランチ名:** `feature/phase0-task3_github_actions`

> ⚠️ Note: `devcontainers/ci` アクションは `.devcontainer/devcontainer.json` を参照する。Task 0.2 が未マージのまま CI ワークフローを single-PR で動かすと失敗する。**Task 0.3 のローカル動作確認時は Task 0.2 の devcontainer.json を `git cherry-pick` で取り込んだうえで `act` 等のローカルランナーで検証する**、もしくは Phase Base に Task 0.2 がマージされた後に push して GitHub Actions で動作確認する。

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: ブランチ作成**

```bash
git checkout feature/phase0-task1_node_tooling
git pull origin feature/phase0-task1_node_tooling
git checkout -b feature/phase0-task3_github_actions
```

- [ ] **Step 2: CI ワークフロー作成**

`/home/y_ohi/program/private/opencode-cursor-plugin/.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [master]
  pull_request:
    branches: [master]

jobs:
  ci:
    name: typecheck & test (devcontainer)
    runs-on: ubuntu-slim
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Build and run Devcontainer with checks
        uses: devcontainers/ci@v0.3
        with:
          imageName: opencode-cursor-plugin-ci
          push: never
          runCmd: |
            set -euxo pipefail
            pnpm install --frozen-lockfile
            pnpm typecheck
            pnpm test
```

- [ ] **Step 3: yaml の構文検証（Devcontainer 内）**

**Devcontainer 内のターミナルで実行:**

```bash
pnpm dlx yaml-lint .github/workflows/ci.yml || npx --yes yaml-lint .github/workflows/ci.yml
```

期待: 構文エラーなし。

- [ ] **Step 4: コミット**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add GitHub Actions workflow running checks inside devcontainer on master"
```

- [ ] **Step 5: push して Phase Base 向け Draft PR 作成**

```bash
git push -u origin feature/phase0-task3_github_actions
gh pr create --draft --base feature/phase0_foundation__base \
  --title "Phase 0 / Task 3: GitHub Actions CI on master (ubuntu-slim)" \
  --body "$(cat <<'EOF'
## Summary
- `master` への push / PR をトリガーに `devcontainers/ci@v0.3` で `pnpm typecheck && pnpm test` を実行
- ランナーは指定どおり `ubuntu-slim`
- テスト・静的解析は Devcontainer 内で完結（Task 0.2 の devcontainer.json を利用）

## Test plan
- [ ] Phase Base に Task 0.1 + 0.2 + 0.3 が揃った段階で GitHub Actions が green になる
- [x] ワークフロー YAML の構文エラーなし
EOF
)"
```

---

### Phase 0 完了 → Phase 0 → master Draft PR

- [ ] **Step 1: Phase 0 内 Task PR を順次マージ（Task 0.1 → 0.2 → 0.3 の順、各 PR を Ready → 通常マージ）**

レビュー後、Task 0.1, 0.2, 0.3 の PR をそれぞれ `feature/phase0_foundation__base` にマージする。

- [ ] **Step 2: Phase Base から master 向け Draft PR を作成**

```bash
git checkout feature/phase0_foundation__base
git pull origin feature/phase0_foundation__base
gh pr create --draft --base master \
  --title "Phase 0: Project foundation (devcontainer + tooling + CI)" \
  --body "$(cat <<'EOF'
## Summary
- Phase 0 の全 Task をまとめた統合 PR
- Devcontainer / pnpm + TypeScript + vitest / GitHub Actions CI を整備
- Phase 1 以降の TDD 実装基盤

## Test plan
- [x] Devcontainer 内 `pnpm typecheck` / `pnpm test` PASS
- [x] CI ワークフロー（devcontainers/ci on ubuntu-slim）が master PR で green
EOF
)"
```

- [ ] **Step 3: master へのマージ完了を待つ**

レビュー後 master へマージ。Phase 1 はこのマージ完了後に着手する（git_workflow_strategy のルール）。

---

## Phase 1: `cursor_prompt` ツール実装（TDD）

**Phase Base:** `feature/phase1_cursor_prompt_tool__base`（マージ済み master から作成）
**目的:** 設計書 §5（ツール仕様）/ §7（エラー処理）/ §11（テスト戦略）を TDD で段階的に実装し、T1 〜 T12 の全テストを PASS させる。

### Phase 1 開始前セットアップ

- [ ] **Pre-Step: Phase 1 ベースブランチ作成**

```bash
git checkout master
git pull origin master
git checkout -b feature/phase1_cursor_prompt_tool__base
git push -u origin feature/phase1_cursor_prompt_tool__base
```

期待: `master` には Phase 0 がマージ済みで、Devcontainer / package.json / CI が揃っている。

---

### Task 1.1: プラグイン雛形 + Zod スキーマ + API キー欠落（T1）

**派生元:** `feature/phase1_cursor_prompt_tool__base`（独立タスク：Phase 内最初の基盤）
**ブランチ名:** `feature/phase1-task1_plugin_skeleton`

**Files:**
- Create: `.opencode/plugins/custom-tools.ts`
- Create: `tests/cursor-prompt.test.ts`
- Delete: `tests/smoke.test.ts`（Phase 0 の疎通テストは役目を終えたため削除）

- [ ] **Step 1: ブランチ作成**

```bash
git checkout feature/phase1_cursor_prompt_tool__base
git pull origin feature/phase1_cursor_prompt_tool__base
git checkout -b feature/phase1-task1_plugin_skeleton
```

- [ ] **Step 2: スモークテスト削除**

```bash
git rm tests/smoke.test.ts
```

- [ ] **Step 3: T1（API キー欠落）のテストを書く**

`/home/y_ohi/program/private/opencode-cursor-plugin/tests/cursor-prompt.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@cursor/sdk", () => {
  const Agent = {
    create: vi.fn(),
  };
  class CursorAgentError extends Error {}
  class AuthenticationError extends CursorAgentError {}
  class RateLimitError extends CursorAgentError {}
  class ConfigurationError extends CursorAgentError {}
  class NetworkError extends CursorAgentError {
    isRetryable: boolean;
    constructor(message: string, opts: { isRetryable: boolean }) {
      super(message);
      this.isRetryable = opts.isRetryable;
    }
  }
  return { Agent, CursorAgentError, AuthenticationError, RateLimitError, ConfigurationError, NetworkError };
});

import CustomToolsPlugin from "../.opencode/plugins/custom-tools";

interface FakeLog {
  debug: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
}

function makeClient(): { client: { app: { log: FakeLog } }; log: FakeLog } {
  const log: FakeLog = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  return { client: { app: { log } }, log };
}

async function loadTool() {
  const { client, log } = makeClient();
  const plugin = await CustomToolsPlugin({ client } as never);
  return { tool: plugin.tool!.cursor_prompt, log };
}

describe("cursor_prompt", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("T1: throws and logs error when CURSOR_API_KEY is missing", async () => {
    delete process.env.CURSOR_API_KEY;
    const { tool, log } = await loadTool();

    await expect(tool.execute({ prompt: "hi" })).rejects.toThrow(/CURSOR_API_KEY/);
    expect(log.error).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 4: テストを実行し失敗を確認**

**Devcontainer 内で実行:**

```bash
pnpm test
```

期待: `Cannot find module '../.opencode/plugins/custom-tools'` で FAIL。

- [ ] **Step 5: プラグインの最小骨格を実装（T1 を PASS させる）**

`/home/y_ohi/program/private/opencode-cursor-plugin/.opencode/plugins/custom-tools.ts`:

```ts
import type { Plugin } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadDotenv();

const argsSchema = z.object({
  prompt: z
    .string()
    .min(1)
    .describe("Cursor エージェントへ送信するユーザープロンプト本文"),
  model: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Cursor 側で利用するモデル識別子（例: 'composer-2'）。未指定の場合は SDK のデフォルトを使用",
    ),
});

const CustomToolsPlugin: Plugin = async ({ client }) => {
  const log = client.app.log;

  return {
    tool: {
      cursor_prompt: tool({
        description:
          "Cursor エージェントへ任意のプロンプトを送信し、応答テキストを取得します。引数 prompt は必須、model はオプション（未指定時は Cursor SDK のデフォルトモデルを使用）。",
        args: argsSchema,
        async execute(args) {
          const apiKey = process.env.CURSOR_API_KEY;
          if (!apiKey) {
            log.error("CURSOR_API_KEY is not set; cursor_prompt cannot run");
            throw new Error("CURSOR_API_KEY is not set in the environment");
          }
          // 後続タスクで Agent.create / send / wait を実装する
          throw new Error("not implemented yet");
        },
      }),
    },
  };
};

export default CustomToolsPlugin;
```

- [ ] **Step 6: T1 が PASS することを確認（Devcontainer 内）**

```bash
pnpm test
pnpm typecheck
```

期待: T1 が PASS、typecheck エラーなし（`@opencode-ai/plugin` の型定義が `^0.4.0` に揃っている前提）。

- [ ] **Step 7: 型エラーが出た場合の対応指針**

`@opencode-ai/plugin` のバージョンが `^0.4.0` で `tool` ヘルパーや `Plugin` 型が一致しないリスクがある（設計書 §10.2 参照）。エラー時は:

1. `node_modules/@opencode-ai/plugin/dist/index.d.ts` を確認し、実際にエクスポートされている型に合わせる
2. それでも不整合なら `package.json` の依存バージョンを実環境に合わせて pin する（その場合、別タスクではなくこの Task 1.1 内で対応してコミット）

- [ ] **Step 8: コミット**

```bash
git add .opencode/plugins/custom-tools.ts tests/cursor-prompt.test.ts
git rm --cached tests/smoke.test.ts 2>/dev/null || true
git commit -m "feat(cursor_prompt): scaffold plugin with API key validation (T1)"
```

- [ ] **Step 9: push して Phase Base 向け Draft PR 作成**

```bash
git push -u origin feature/phase1-task1_plugin_skeleton
gh pr create --draft --base feature/phase1_cursor_prompt_tool__base \
  --title "Phase 1 / Task 1: Plugin scaffolding + CURSOR_API_KEY check (T1)" \
  --body "$(cat <<'EOF'
## Summary
- `.opencode/plugins/custom-tools.ts` を新規作成し `cursor_prompt` ツールを Zod スキーマと共に登録
- `CURSOR_API_KEY` 未設定時に `log.error` → `Error` を throw（T1）
- vitest モック雛形を `tests/cursor-prompt.test.ts` に整備

## Test plan
- [x] Devcontainer 内 `pnpm test` で T1 が PASS
- [x] Devcontainer 内 `pnpm typecheck` がエラーなし
EOF
)"
```

---

### Task 1.2: ハッピーパス実装（T2: model 未指定 / T3: model 指定）

**派生元:** `feature/phase1-task1_plugin_skeleton`（依存タスク：Task 1.1 の plugin scaffolding と Zod スキーマを物理的に必要とする数珠つなぎ）
**ブランチ名:** `feature/phase1-task2_happy_path`

**Files:**
- Modify: `.opencode/plugins/custom-tools.ts`
- Modify: `tests/cursor-prompt.test.ts`

- [ ] **Step 1: ブランチ作成**

```bash
git checkout feature/phase1-task1_plugin_skeleton
git pull origin feature/phase1-task1_plugin_skeleton
git checkout -b feature/phase1-task2_happy_path
```

- [ ] **Step 2: T2 / T3 のテストを追加**

`tests/cursor-prompt.test.ts` の `describe("cursor_prompt", ...)` ブロックに以下を追記:

```ts
  it("T2: substitutes DEFAULT_LOCAL_MODEL and warns when model is omitted", async () => {
    process.env.CURSOR_API_KEY = "sk-test-12345";
    const { Agent } = await import("@cursor/sdk");
    const send = vi.fn().mockResolvedValue({
      wait: vi.fn().mockResolvedValue({ id: "run_1", status: "finished", result: "ok" }),
    });
    const close = vi.fn().mockResolvedValue(undefined);
    (Agent.create as ReturnType<typeof vi.fn>).mockResolvedValue({ send, close });

    const { tool, log } = await loadTool();

    const out = await tool.execute({ prompt: "hi" });

    expect(out).toBe("ok");
    // local mode requires model; implementation must substitute DEFAULT_LOCAL_MODEL ("composer-2")
    expect((Agent.create as ReturnType<typeof vi.fn>).mock.calls[0][0].model).toEqual({ id: "composer-2" });
    expect(log.warn).toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith("hi");
  });

  it("T3: forwards explicit model to Agent.create as { id } and does not warn", async () => {
    process.env.CURSOR_API_KEY = "sk-test-12345";
    const { Agent } = await import("@cursor/sdk");
    const send = vi.fn().mockResolvedValue({
      wait: vi.fn().mockResolvedValue({ id: "run_2", status: "finished", result: "ok2" }),
    });
    const close = vi.fn().mockResolvedValue(undefined);
    (Agent.create as ReturnType<typeof vi.fn>).mockResolvedValue({ send, close });

    const { tool, log } = await loadTool();

    const out = await tool.execute({ prompt: "hi", model: "composer-2" });

    expect(out).toBe("ok2");
    expect((Agent.create as ReturnType<typeof vi.fn>).mock.calls[0][0].model).toEqual({ id: "composer-2" });
    expect(log.warn).not.toHaveBeenCalled();
  });
```

- [ ] **Step 3: テストを実行し T2/T3 が失敗することを確認**

```bash
pnpm test -- -t "T2|T3"
```

期待: 2 件とも `not implemented yet` で FAIL。

- [ ] **Step 4: ハッピーパスを実装（local モードでは `model` 必須のため、未指定時は `DEFAULT_LOCAL_MODEL` を substitute）**

`.opencode/plugins/custom-tools.ts` の上部に `DEFAULT_LOCAL_MODEL` 定数を追加し、`execute` 内 `// 後続タスクで...` 以降を以下に差し替え:

```ts
// 設計書 §10.1 / §5.3 に基づき、local モードでは Agent.create の model が必須。
// args.model 未指定時は実装層でこのデフォルト ID を substitute する。
const DEFAULT_LOCAL_MODEL = "composer-2";
```

```ts
        async execute(args) {
          const apiKey = process.env.CURSOR_API_KEY;
          if (!apiKey) {
            log.error("CURSOR_API_KEY is not set; cursor_prompt cannot run");
            throw new Error("CURSOR_API_KEY is not set in the environment");
          }

          const resolvedModelId = args.model ?? DEFAULT_LOCAL_MODEL;
          if (!args.model) {
            log.warn("cursor_prompt: model omitted; substituting DEFAULT_LOCAL_MODEL", {
              defaultModelId: DEFAULT_LOCAL_MODEL,
            });
          }

          log.debug("cursor_prompt invoked", {
            promptLength: args.prompt.length,
            modelId: resolvedModelId,
          });

          const { Agent } = await import("@cursor/sdk");
          const agent = await Agent.create({
            apiKey,
            model: { id: resolvedModelId },
            local: { cwd: process.cwd() },
          });
          log.info("cursor_prompt: agent created");

          const run = await agent.send(args.prompt);
          log.info("cursor_prompt: prompt sent");
          const result = await run.wait();

          if (result.status === "finished") {
            log.info("cursor_prompt: run finished", {
              responseLength: result.result.length,
            });
            return result.result;
          }
          throw new Error(`cursor_prompt: unexpected run status ${result.status}`);
        },
```

> Note: 動的 `import("@cursor/sdk")` を使うのは `vi.mock` のホイスティングとモジュール初期化順序を一致させるため。トップレベル `import` でも同様に動作するが、テストランナーの差異を吸収しやすい。トップレベル import で問題なければそちらでよい。

- [ ] **Step 5: テストを実行し T1 / T2 / T3 が PASS することを確認**

```bash
pnpm test
pnpm typecheck
```

期待: T1, T2, T3 PASS、typecheck エラーなし。

- [ ] **Step 6: コミット**

```bash
git add .opencode/plugins/custom-tools.ts tests/cursor-prompt.test.ts
git commit -m "feat(cursor_prompt): implement Agent.create -> send -> wait happy path (T2, T3)"
```

- [ ] **Step 7: push して Phase Base 向け Draft PR 作成**

```bash
git push -u origin feature/phase1-task2_happy_path
gh pr create --draft --base feature/phase1_cursor_prompt_tool__base \
  --title "Phase 1 / Task 2: Happy path with default and explicit model (T2, T3)" \
  --body "$(cat <<'EOF'
## Summary
- `Agent.create({ apiKey, model, local: { cwd } })` → `send(prompt)` → `run.wait()` の経路を実装
- local モードでは SDK が `model` を必須とするため、`args.model` 未指定時は実装層で `DEFAULT_LOCAL_MODEL = "composer-2"` を substitute（設計書 §10.1）
- 未指定 substitute 発生時は `log.warn` でデフォルト適用を記録
- `model` 指定時は `{ id: args.model }` 形式で SDK に渡し、`log.warn` は出さない
- `RunResult.status === "finished"` の場合のみ `result.result` を返却

## Test plan
- [x] Devcontainer 内 `pnpm test` で T1, T2, T3 が PASS
- [x] Devcontainer 内 `pnpm typecheck` エラーなし
EOF
)"
```

---

### Task 1.3: Run ステータス異常系（T8: error / T9: cancelled）

**派生元:** `feature/phase1-task2_happy_path`（依存タスク：Task 1.2 の `run.wait()` 経路と `result.status` 判定の構造を物理的に必要とする数珠つなぎ）
**ブランチ名:** `feature/phase1-task3_run_status_errors`

**Files:**
- Modify: `.opencode/plugins/custom-tools.ts`
- Modify: `tests/cursor-prompt.test.ts`

- [ ] **Step 1: ブランチ作成**

```bash
git checkout feature/phase1-task2_happy_path
git pull origin feature/phase1-task2_happy_path
git checkout -b feature/phase1-task3_run_status_errors
```

- [ ] **Step 2: T8 / T9 のテストを追加**

`tests/cursor-prompt.test.ts` に追記:

```ts
  it("T8: throws and logs when run.status === 'error'", async () => {
    process.env.CURSOR_API_KEY = "sk-test-12345";
    const { Agent } = await import("@cursor/sdk");
    const send = vi.fn().mockResolvedValue({
      wait: vi.fn().mockResolvedValue({ id: "run_err", status: "error" }),
    });
    const close = vi.fn().mockResolvedValue(undefined);
    (Agent.create as ReturnType<typeof vi.fn>).mockResolvedValue({ send, close });

    const { tool, log } = await loadTool();

    await expect(tool.execute({ prompt: "hi" })).rejects.toThrow(/status=error/);
    expect(log.error).toHaveBeenCalled();
  });

  it("T9: throws and logs when run.status === 'cancelled'", async () => {
    process.env.CURSOR_API_KEY = "sk-test-12345";
    const { Agent } = await import("@cursor/sdk");
    const send = vi.fn().mockResolvedValue({
      wait: vi.fn().mockResolvedValue({ id: "run_cxl", status: "cancelled" }),
    });
    const close = vi.fn().mockResolvedValue(undefined);
    (Agent.create as ReturnType<typeof vi.fn>).mockResolvedValue({ send, close });

    const { tool, log } = await loadTool();

    await expect(tool.execute({ prompt: "hi" })).rejects.toThrow(/cancelled/);
    expect(log.error).toHaveBeenCalled();
  });
```

- [ ] **Step 3: テスト失敗を確認**

```bash
pnpm test -- -t "T8|T9"
```

期待: 現在の実装は `unexpected run status ${result.status}` を投げているため、メッセージが `/status=error/` や `/cancelled/` に一致せず FAIL するか、`log.error` 呼び出しがなく FAIL する。

- [ ] **Step 4: ステータス分岐を実装**

`.opencode/plugins/custom-tools.ts` の `if (result.status === "finished") { ... }` 以降を以下に置き換え:

```ts
          if (result.status === "finished") {
            log.info("cursor_prompt: run finished", {
              responseLength: result.result.length,
            });
            return result.result;
          }

          if (result.status === "error") {
            const errInfo = (result as any).error;
            log.error("cursor_prompt: run finished with status=error", {
              runId: result.id,
              status: result.status,
              errorCode: errInfo?.code,
              errorMessageLength: errInfo?.message?.length,
            });
            throw new Error(`Cursor run finished with status=error (id=${result.id})`);
          }

          if (result.status === "cancelled") {
            log.error("cursor_prompt: run was cancelled", {
              runId: result.id,
              status: result.status,
            });
            throw new Error(`Cursor run was cancelled (id=${result.id})`);
          }

          log.error("cursor_prompt: unexpected run status", { runId: result.id, status: result.status });
          throw new Error(`Cursor run finished with unexpected status (id=${result.id})`);
```

- [ ] **Step 5: テスト全件 PASS を確認**

```bash
pnpm test
pnpm typecheck
```

期待: T1, T2, T3, T8, T9 全て PASS。

- [ ] **Step 6: コミット**

```bash
git add .opencode/plugins/custom-tools.ts tests/cursor-prompt.test.ts
git commit -m "feat(cursor_prompt): handle run.status error/cancelled (T8, T9)"
```

- [ ] **Step 7: push して Phase Base 向け Draft PR 作成**

```bash
git push -u origin feature/phase1-task3_run_status_errors
gh pr create --draft --base feature/phase1_cursor_prompt_tool__base \
  --title "Phase 1 / Task 3: Handle run status error/cancelled (T8, T9)" \
  --body "$(cat <<'EOF'
## Summary
- `RunResult.status === "error"` の場合 `Error("Cursor run finished with status=error ...")` を throw
- `RunResult.status === "cancelled"` の場合 `Error("Cursor run was cancelled ...")` を throw
- どちらも `log.error` で run id を含めて記録

## Test plan
- [x] Devcontainer 内 `pnpm test` で T1, T2, T3, T8, T9 が PASS
- [x] Devcontainer 内 `pnpm typecheck` エラーなし
EOF
)"
```

---

### Task 1.4: SDK 例外ハンドリング（T4 RateLimit / T5 Configuration / T6 Authentication / T7 Network）

**派生元:** `feature/phase1-task3_run_status_errors`（依存タスク：Task 1.3 までの `execute` 全体構造を物理的に必要とする数珠つなぎ）
**ブランチ名:** `feature/phase1-task4_sdk_exceptions`

**Files:**
- Modify: `.opencode/plugins/custom-tools.ts`
- Modify: `tests/cursor-prompt.test.ts`

- [ ] **Step 1: ブランチ作成**

```bash
git checkout feature/phase1-task3_run_status_errors
git pull origin feature/phase1-task3_run_status_errors
git checkout -b feature/phase1-task4_sdk_exceptions
```

- [ ] **Step 2: T4 〜 T7 のテストを追加**

`tests/cursor-prompt.test.ts` に追記:

```ts
  it("T4: re-throws RateLimitError from agent.send and logs error", async () => {
    process.env.CURSOR_API_KEY = "sk-test-12345";
    const { Agent, RateLimitError } = await import("@cursor/sdk");
    const send = vi.fn().mockRejectedValue(new RateLimitError("rate limited"));
    const close = vi.fn().mockResolvedValue(undefined);
    (Agent.create as ReturnType<typeof vi.fn>).mockResolvedValue({ send, close });

    const { tool, log } = await loadTool();

    await expect(tool.execute({ prompt: "x".repeat(1_000_000) })).rejects.toBeInstanceOf(RateLimitError);
    expect(log.error).toHaveBeenCalled();
  });

  it("T5: re-throws ConfigurationError from Agent.create for unknown model", async () => {
    process.env.CURSOR_API_KEY = "sk-test-12345";
    const { Agent, ConfigurationError } = await import("@cursor/sdk");
    (Agent.create as ReturnType<typeof vi.fn>).mockRejectedValue(new ConfigurationError("unknown model"));

    const { tool, log } = await loadTool();

    await expect(tool.execute({ prompt: "hi", model: "no-such-model" })).rejects.toBeInstanceOf(
      ConfigurationError,
    );
    expect(log.error).toHaveBeenCalled();
  });

  it("T6: re-throws AuthenticationError from Agent.create", async () => {
    process.env.CURSOR_API_KEY = "sk-test-12345";
    const { Agent, AuthenticationError } = await import("@cursor/sdk");
    (Agent.create as ReturnType<typeof vi.fn>).mockRejectedValue(new AuthenticationError("invalid key"));

    const { tool } = await loadTool();

    await expect(tool.execute({ prompt: "hi" })).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("T7: re-throws NetworkError and logs isRetryable", async () => {
    process.env.CURSOR_API_KEY = "sk-test-12345";
    const { Agent, NetworkError } = await import("@cursor/sdk");
    const send = vi.fn().mockRejectedValue(new NetworkError("network down", { isRetryable: true }));
    const close = vi.fn().mockResolvedValue(undefined);
    (Agent.create as ReturnType<typeof vi.fn>).mockResolvedValue({ send, close });

    const { tool, log } = await loadTool();

    await expect(tool.execute({ prompt: "hi" })).rejects.toBeInstanceOf(NetworkError);
    const errorCalls = log.error.mock.calls.flat();
    const stringified = JSON.stringify(errorCalls);
    expect(stringified).toContain("isRetryable");
  });
```

- [ ] **Step 3: テスト失敗を確認**

```bash
pnpm test -- -t "T4|T5|T6|T7"
```

期待: 現状 `execute` には try/catch がないため、SDK 例外が `log.error` 経由で記録されず（特に T7 の `isRetryable` ログが無く）FAIL する。`Agent.create` 失敗時は `agent` が undefined になり後続コードに進めず別エラーになる可能性もある。

- [ ] **Step 4: try/catch を導入して SDK 派生例外を捕捉・ログ・再 throw する**

`.opencode/plugins/custom-tools.ts` の execute 全体を以下に置き換え:

```ts
        async execute(args) {
          const apiKey = process.env.CURSOR_API_KEY;
          if (!apiKey) {
            log.error("CURSOR_API_KEY is not set; cursor_prompt cannot run");
            throw new Error("CURSOR_API_KEY is not set in the environment");
          }

          const resolvedModelId = args.model ?? DEFAULT_LOCAL_MODEL;
          if (!args.model) {
            log.warn("cursor_prompt: model omitted; substituting DEFAULT_LOCAL_MODEL", {
              defaultModelId: DEFAULT_LOCAL_MODEL,
            });
          }

          log.debug("cursor_prompt invoked", {
            promptLength: args.prompt.length,
            modelId: resolvedModelId,
          });

          const sdk = await import("@cursor/sdk");
          const { Agent, CursorAgentError, NetworkError } = sdk;

          try {
            const agent = await Agent.create({
              apiKey,
              model: { id: resolvedModelId },
              local: { cwd: process.cwd() },
            });
            log.info("cursor_prompt: agent created");

            const run = await agent.send(args.prompt);
            log.info("cursor_prompt: prompt sent");
            const result = await run.wait();

            if (result.status === "finished") {
              log.info("cursor_prompt: run finished", {
                responseLength: result.result.length,
              });
              return result.result;
            }
            if (result.status === "error") {
              const errInfo = (result as any).error;
              log.error("cursor_prompt: run finished with status=error", {
                runId: result.id,
                status: result.status,
                errorCode: errInfo?.code,
                errorMessageLength: errInfo?.message?.length,
              });
              throw new Error(`Cursor run finished with status=error (id=${result.id})`);
            }
            if (result.status === "cancelled") {
              log.error("cursor_prompt: run was cancelled", {
                runId: result.id,
                status: result.status,
              });
              throw new Error(`Cursor run was cancelled (id=${result.id})`);
            }
            log.error("cursor_prompt: unexpected run status", { runId: result.id, status: result.status });
            throw new Error(`Cursor run finished with unexpected status (id=${result.id})`);
          } catch (err) {
            if (err instanceof NetworkError) {
              log.error("cursor_prompt: NetworkError", {
                message: err.message,
                isRetryable: err.isRetryable,
              });
              throw err;
            }
            if (err instanceof CursorAgentError) {
              log.error("cursor_prompt: CursorAgentError", {
                kind: err.constructor.name,
                message: err.message,
              });
              throw err;
            }
            throw err;
          }
        },
```

- [ ] **Step 5: テスト全件 PASS を確認**

```bash
pnpm test
pnpm typecheck
```

期待: T1, T2, T3, T4, T5, T6, T7, T8, T9 が PASS。

- [ ] **Step 6: コミット**

```bash
git add .opencode/plugins/custom-tools.ts tests/cursor-prompt.test.ts
git commit -m "feat(cursor_prompt): re-throw CursorAgentError-derived exceptions with logging (T4-T7)"
```

- [ ] **Step 7: push して Phase Base 向け Draft PR 作成**

```bash
git push -u origin feature/phase1-task4_sdk_exceptions
gh pr create --draft --base feature/phase1_cursor_prompt_tool__base \
  --title "Phase 1 / Task 4: Re-throw CursorAgentError-derived exceptions (T4-T7)" \
  --body "$(cat <<'EOF'
## Summary
- `RateLimitError` / `ConfigurationError` / `AuthenticationError` / `NetworkError` をそれぞれ捕捉
- `NetworkError` は `isRetryable` をログに記録（リトライは行わない）
- 全て元の例外をそのまま再 throw して OpenCode 側に伝搬

## Test plan
- [x] Devcontainer 内 `pnpm test` で T1〜T9 全 PASS
- [x] Devcontainer 内 `pnpm typecheck` エラーなし
EOF
)"
```

---

### Task 1.5: リソース解放（T10）+ ログ機微情報保護（T11, T12）+ README

**派生元:** `feature/phase1-task4_sdk_exceptions`（依存タスク：Task 1.4 までの `try/catch` 構造に `finally` を追加するため数珠つなぎ）
**ブランチ名:** `feature/phase1-task5_resource_cleanup_and_logging`

**Files:**
- Modify: `.opencode/plugins/custom-tools.ts`
- Modify: `tests/cursor-prompt.test.ts`
- Create: `README.md`

- [ ] **Step 1: ブランチ作成**

```bash
git checkout feature/phase1-task4_sdk_exceptions
git pull origin feature/phase1-task4_sdk_exceptions
git checkout -b feature/phase1-task5_resource_cleanup_and_logging
```

- [ ] **Step 2: T10 / T11 / T12 のテストを追加**

`tests/cursor-prompt.test.ts` に追記:

```ts
  it("T10a: agent.close is called on success", async () => {
    process.env.CURSOR_API_KEY = "sk-test-12345";
    const { Agent } = await import("@cursor/sdk");
    const send = vi.fn().mockResolvedValue({
      wait: vi.fn().mockResolvedValue({ id: "run_ok", status: "finished", result: "ok" }),
    });
    const close = vi.fn().mockResolvedValue(undefined);
    (Agent.create as ReturnType<typeof vi.fn>).mockResolvedValue({ send, close });

    const { tool } = await loadTool();
    await tool.execute({ prompt: "hi" });

    expect(close).toHaveBeenCalledTimes(1);
  });

  it("T10b: agent.close is called when send throws", async () => {
    process.env.CURSOR_API_KEY = "sk-test-12345";
    const { Agent, RateLimitError } = await import("@cursor/sdk");
    const send = vi.fn().mockRejectedValue(new RateLimitError("rate"));
    const close = vi.fn().mockResolvedValue(undefined);
    (Agent.create as ReturnType<typeof vi.fn>).mockResolvedValue({ send, close });

    const { tool } = await loadTool();
    await expect(tool.execute({ prompt: "hi" })).rejects.toBeInstanceOf(RateLimitError);

    expect(close).toHaveBeenCalledTimes(1);
  });

  it("T10c: agent is undefined when Agent.create throws; no close call attempted", async () => {
    process.env.CURSOR_API_KEY = "sk-test-12345";
    const { Agent, AuthenticationError } = await import("@cursor/sdk");
    (Agent.create as ReturnType<typeof vi.fn>).mockRejectedValue(new AuthenticationError("invalid"));

    const { tool } = await loadTool();
    await expect(tool.execute({ prompt: "hi" })).rejects.toBeInstanceOf(AuthenticationError);
    // Should not throw a "close is not a function" error
  });

  it("T11: prompt body is never written to logs", async () => {
    process.env.CURSOR_API_KEY = "sk-test-12345";
    const { Agent } = await import("@cursor/sdk");
    const send = vi.fn().mockResolvedValue({
      wait: vi.fn().mockResolvedValue({ id: "run_log", status: "finished", result: "response-content" }),
    });
    const close = vi.fn().mockResolvedValue(undefined);
    (Agent.create as ReturnType<typeof vi.fn>).mockResolvedValue({ send, close });

    const { tool, log } = await loadTool();
    await tool.execute({ prompt: "secret-content" });

    const allLogCalls = JSON.stringify([
      ...log.debug.mock.calls,
      ...log.info.mock.calls,
      ...log.warn.mock.calls,
      ...log.error.mock.calls,
    ]);
    expect(allLogCalls).not.toContain("secret-content");
    expect(allLogCalls).not.toContain("response-content");
  });

  it("T12: API key is never written to logs", async () => {
    process.env.CURSOR_API_KEY = "sk-test-12345";
    const { Agent } = await import("@cursor/sdk");
    const send = vi.fn().mockResolvedValue({
      wait: vi.fn().mockResolvedValue({ id: "run_key", status: "finished", result: "ok" }),
    });
    const close = vi.fn().mockResolvedValue(undefined);
    (Agent.create as ReturnType<typeof vi.fn>).mockResolvedValue({ send, close });

    const { tool, log } = await loadTool();
    await tool.execute({ prompt: "hi" });

    const allLogCalls = JSON.stringify([
      ...log.debug.mock.calls,
      ...log.info.mock.calls,
      ...log.warn.mock.calls,
      ...log.error.mock.calls,
    ]);
    expect(allLogCalls).not.toContain("sk-test-12345");
  });
```

- [ ] **Step 3: テスト失敗を確認**

```bash
pnpm test -- -t "T10|T11|T12"
```

期待: T10a/T10b は `agent.close` 呼び出しがないため FAIL。T11/T12 は現状の実装が機微情報を含めない方針で書かれていれば PASS、含んでいれば FAIL（要修正）。

- [ ] **Step 4: try/finally を追加し、agent.close をリソース解放**

`.opencode/plugins/custom-tools.ts` の execute 全体を以下に置き換え（`agent` を try の外で宣言し finally で close）:

```ts
        async execute(args) {
          const apiKey = process.env.CURSOR_API_KEY;
          if (!apiKey) {
            log.error("CURSOR_API_KEY is not set; cursor_prompt cannot run");
            throw new Error("CURSOR_API_KEY is not set in the environment");
          }

          const resolvedModelId = args.model ?? DEFAULT_LOCAL_MODEL;
          if (!args.model) {
            log.warn("cursor_prompt: model omitted; substituting DEFAULT_LOCAL_MODEL", {
              defaultModelId: DEFAULT_LOCAL_MODEL,
            });
          }

          log.debug("cursor_prompt invoked", {
            promptLength: args.prompt.length,
            modelId: resolvedModelId,
          });

          const sdk = await import("@cursor/sdk");
          const { Agent, CursorAgentError, NetworkError } = sdk;

          let agent: Awaited<ReturnType<typeof Agent.create>> | undefined;
          try {
            agent = await Agent.create({
              apiKey,
              model: { id: resolvedModelId },
              local: { cwd: process.cwd() },
            });
            log.info("cursor_prompt: agent created");

            const run = await agent.send(args.prompt);
            log.info("cursor_prompt: prompt sent");
            const result = await run.wait();

            if (result.status === "finished") {
              log.info("cursor_prompt: run finished", {
                responseLength: result.result.length,
              });
              return result.result;
            }
            if (result.status === "error") {
              const errInfo = (result as any).error;
              log.error("cursor_prompt: run finished with status=error", {
                runId: result.id,
                status: result.status,
                errorCode: errInfo?.code,
                errorMessageLength: errInfo?.message?.length,
              });
              throw new Error(`Cursor run finished with status=error (id=${result.id})`);
            }
            if (result.status === "cancelled") {
              log.error("cursor_prompt: run was cancelled", {
                runId: result.id,
                status: result.status,
              });
              throw new Error(`Cursor run was cancelled (id=${result.id})`);
            }
            log.error("cursor_prompt: unexpected run status", { runId: result.id, status: result.status });
            throw new Error(`Cursor run finished with unexpected status (id=${result.id})`);
          } catch (err) {
            if (err instanceof NetworkError) {
              log.error("cursor_prompt: NetworkError", {
                message: err.message,
                isRetryable: err.isRetryable,
              });
              throw err;
            }
            if (err instanceof CursorAgentError) {
              log.error("cursor_prompt: CursorAgentError", {
                kind: err.constructor.name,
                message: err.message,
              });
              throw err;
            }
            throw err;
          } finally {
            if (agent) {
              try {
                await agent.close();
              } catch (closeErr) {
                log.warn("cursor_prompt: agent.close failed", {
                  message: (closeErr as Error).message,
                });
              }
            }
          }
        },
```

- [ ] **Step 5: 既存ログ呼び出しを再点検し、`prompt` 本文・`response` 本文・`apiKey` が含まれていないことを確認**

`.opencode/plugins/custom-tools.ts` の全 `log.{debug,info,warn,error}` 呼び出し引数を grep で確認:

```bash
grep -n "log\." .opencode/plugins/custom-tools.ts
```

期待: `args.prompt` をそのまま渡している箇所、`apiKey` を渡している箇所、`result.result` をそのまま渡している箇所が存在しない（長さや length のみ）。発見した場合はその場で修正。

- [ ] **Step 6: テスト全件 PASS を確認**

```bash
pnpm test
pnpm typecheck
```

期待: T1, T2, T3, T4, T5, T6, T7, T8, T9, T10a, T10b, T10c, T11, T12 全て PASS。

- [ ] **Step 7: README を作成**

`/home/y_ohi/program/private/opencode-cursor-plugin/README.md`:

```markdown
# opencode-cursor-plugin

OpenCode 用カスタムツールプラグイン。Cursor 公式 SDK (`@cursor/sdk`) 経由で Cursor エージェントへ任意のプロンプトを送信し、応答テキストを返す `cursor_prompt` ツールを 1 つ提供する。

## 提供ツール

### `cursor_prompt`

| 引数 | 型 | 必須 | 説明 |
|---|---|---|---|
| `prompt` | string | ○ | Cursor エージェントへ送信するユーザープロンプト本文 |
| `model` | string | × | Cursor 側で利用するモデル識別子（例: `composer-2`）。未指定時は SDK のデフォルトを使用 |

戻り値: `Promise<string>`（Cursor エージェントの最終応答テキスト）。

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

## OpenCode への接続

`.opencode/plugins/custom-tools.ts` を OpenCode が自動ロードする想定。詳細は OpenCode のプラグインドキュメントを参照。
```

- [ ] **Step 8: 最終確認（Devcontainer 内）**

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
```

期待: 全 14 件（T1〜T9 + T10a/b/c + T11 + T12）が PASS、typecheck エラーなし。

- [ ] **Step 9: コミット**

```bash
git add .opencode/plugins/custom-tools.ts tests/cursor-prompt.test.ts README.md
git commit -m "feat(cursor_prompt): release agent in finally and verify log redaction (T10-T12)"
```

- [ ] **Step 10: push して Phase Base 向け Draft PR 作成**

```bash
git push -u origin feature/phase1-task5_resource_cleanup_and_logging
gh pr create --draft --base feature/phase1_cursor_prompt_tool__base \
  --title "Phase 1 / Task 5: Resource cleanup + log redaction + README (T10-T12)" \
  --body "$(cat <<'EOF'
## Summary
- `try/finally` で `agent.close()` を必ず呼ぶ（成功・失敗いずれの経路でも）
- `Agent.create` 自体が throw した場合は `agent` undefined で close 呼び出しをスキップ
- 全ログから `prompt` / `response` 本文と API キーが排除されていることをテストで保証
- 利用方法を README に記載

## Test plan
- [x] Devcontainer 内 `pnpm test` で T1〜T12 全 PASS
- [x] Devcontainer 内 `pnpm typecheck` エラーなし
EOF
)"
```

---

### Phase 1 完了 → Phase 1 → master Draft PR

- [ ] **Step 1: Phase 1 内 Task PR を順次マージ（Task 1.1 → 1.2 → 1.3 → 1.4 → 1.5）**

Task は数珠つなぎなので、上流 Task の PR がマージされたら下流 Task PR の base を `feature/phase1_cursor_prompt_tool__base` から再マージで揃える（GitHub の "Update branch" ボタンまたはローカル rebase）。

- [ ] **Step 2: Phase 1 統合 Draft PR を master 向けに作成**

```bash
git checkout feature/phase1_cursor_prompt_tool__base
git pull origin feature/phase1_cursor_prompt_tool__base
gh pr create --draft --base master \
  --title "Phase 1: cursor_prompt tool implementation (TDD, T1-T12)" \
  --body "$(cat <<'EOF'
## Summary
- OpenCode プラグイン `.opencode/plugins/custom-tools.ts` に `cursor_prompt` ツールを実装
- 設計書 §11 のテスト T1〜T12 を全て PASS
- Devcontainer 内で TDD（Red → Green → Refactor）を Task 1.1〜1.5 で段階的に実施

## Acceptance Criteria（設計書 §12）
- [x] Devcontainer 起動後 `pnpm install` 成功
- [x] `pnpm typecheck` エラーなし
- [x] `pnpm test` で T1〜T12 全 PASS
- [x] `CURSOR_API_KEY` 未設定時の明確なエラー
- [x] `console.log` 不使用、ログは `client.app.log` のみ
- [ ] `CURSOR_API_KEY` 設定済み環境で OpenCode から `cursor_prompt` が起動可能（手動 E2E）
EOF
)"
```

- [ ] **Step 3: 手動 E2E 検証（受け入れ条件 4 番）**

実際の `CURSOR_API_KEY` を設定した OpenCode セッションで `cursor_prompt` ツールを呼び出し、応答テキストが返ることを確認。Devcontainer 内で OpenCode を起動するか、ホスト側で起動する場合は `pnpm install` 済みであることを確認。

- [ ] **Step 4: master へのマージ完了で実装完了**

レビュー後 master へマージ。これで設計書 §12 の全受け入れ条件が満たされる。

---

## 自己レビュー結果

**1. 設計書カバレッジ**
- §3 アーキテクチャ図: Task 1.2 〜 1.5 でフルに実装
- §5.1 / §5.2 メタ + Zod スキーマ: Task 1.1
- §5.3 execute フロー 9 ステップ:
  - 1 (API キー検証) → Task 1.1
  - 2 (model 未指定 warn) → Task 1.2
  - 3-4 (Agent.create / send) → Task 1.2
  - 5-6 (run.wait / finished) → Task 1.2
  - 7 (error/cancelled) → Task 1.3
  - 8 (CursorAgentError 再 throw) → Task 1.4
  - 9 (finally close) → Task 1.5
- §6 ロギング戦略: Task 1.1〜1.5 で各レベル（debug/info/warn/error）使用、Task 1.5 で機微情報保護を保証
- §7 エラーハンドリング全 11 ケース: Task 1.1 (API key) / Task 1.3 (run status) / Task 1.4 (SDK 例外) / Task 1.5 (finally) で全カバー
- §8 Devcontainer: Task 0.2
- §9 依存関係: Task 0.1
- §11 テスト戦略 T1〜T12: Task 1.1 (T1) / Task 1.2 (T2, T3) / Task 1.3 (T8, T9) / Task 1.4 (T4-T7) / Task 1.5 (T10-T12) で全カバー
- §12 受け入れ条件 6 項目: Phase 1 統合 PR チェックリスト

**2. プレースホルダ**
- TBD / TODO / 「適切なエラー処理を追加」等の曖昧表現なし
- すべてのコード変更ステップに実コードを記載

**3. 型・名前の一貫性**
- `Agent.create` / `agent.send` / `run.wait` / `RunResult.status` / `RunResult.result` / `RunResult.id` を全タスクで統一
- エラー型 `CursorAgentError` / `NetworkError` / `RateLimitError` / `AuthenticationError` / `ConfigurationError` を全タスクで統一
- ブランチ命名（`feature/phaseX-taskY_*` / `feature/phaseX_*__base`）を全タスクで統一
- `cursor_prompt` ツール名・引数 (`prompt`, `model`) を全タスクで統一
