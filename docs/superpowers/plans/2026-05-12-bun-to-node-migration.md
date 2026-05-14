# Bun → Node.js (>= 20) 完全移行 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bun ランタイム由来の `sqlite3` セグメンテーションフォールトを根絶するため、Node.js 20+ 運用への統一・Devcontainer 整備・Agent ライフサイクル堅牢化・(PoC 成功時のみ) `Agent.create` への `local: { cwd }` 明示を実装する。

**Architecture:** 設計書 `docs/superpowers/specs/2026-05-12-bun-to-node-migration-design.md` に準拠する。4 つの Phase に分割し、Phase 2 を PoC ゲートとして Phase 4 の実装方針 (`local` オプション採否) を分岐させる。Dispose 経路は「タイムアウト = リトライ禁止 / 例外 = 1 回リトライ」の非対称設計を採用する。

**Tech Stack:** Node.js 20+, TypeScript 5.5, pnpm 9.12.0, Vitest 1.6, Biome 1.9, `@cursor/sdk` 1.0.12, `@opencode-ai/plugin` ^1.14.30, Devcontainer (`mcr.microsoft.com/devcontainers/javascript-node:20`)

---

## 前提条件と現状

- **CI/CD**: `.github/workflows/ci.yml` は既存。`runs-on: ubuntu-slim`、`master` ブランチへの `push` と `pull_request` がトリガー。Node 20 / pnpm 9.12.0 を使用。**Phase 0 不要**。
- **Devcontainer**: `.devcontainer/Dockerfile` / `.devcontainer/devcontainer.json` 既存。Dockerfile は `typescript-node@sha256:...` を使用しており、設計書の `javascript-node:20` への差し替えが必要。
- **biome.json**: 既存。Biome 本体は `devDependencies` 未登録のため追加する。
- **テスト**: `tests/agent-cleanup.test.ts` 等、Vitest ベースのテストが既存。
- **Git 起点**: `master`（`b6c1dfc`）。
- **検証の場**: 本計画のすべてのテスト・型検査・Lint は **Devcontainer 内で実行する**（後述）。

### Devcontainer での検証コマンドの起動方法

> [!IMPORTANT]
> 計画内の `pnpm typecheck` / `pnpm test` / `pnpm lint` / `pnpm install --frozen-lockfile` は、すべて **Devcontainer 内のシェル** で実行してください。
> - VS Code: `Dev Containers: Reopen in Container`
> - Cursor: `Reopen in Container` パレットコマンド
> - CLI: `devcontainer up --workspace-folder .` でコンテナを起動後、`devcontainer exec --workspace-folder . pnpm <command>` で実行
>
> ホスト側 OS 上で実行した場合、`sqlite3` のネイティブ再現性が保証されないため、エビデンスとして採用しないでください。

---

## File Structure

```text
modified:
  .devcontainer/Dockerfile               base image を javascript-node:20 へ。Node 20 系の固定化を強化
  .devcontainer/devcontainer.json        extensions に biomejs.biome / vitest.explorer、postCreateCommand に Node20 ガード
  package.json                           devDependencies に @biomejs/biome、scripts に lint を追加
  src/index.ts                           POOL_CAPACITY 8 → 10
  src/agent-cleanup.ts                   非対称リトライ (timeout 経路は据置 / catch 経路で 1 回リトライ) と RETRY_DELAY_MS 追加
  src/openai-proxy.ts                    [PoC 成功時のみ] Agent.create({ ..., local: { cwd: process.cwd() } })
  src/provider.ts                        [PoC 成功時のみ] performAgentCreationAttempt の型と呼び出しを AgentCreateOpts に拡張
  AGENTS.md                              <commands> セクションに Devcontainer 必須化を明記
  README.md                              利用者向けセクションに Devcontainer 必須化を追記
  tests/agent-cleanup.test.ts            非対称設計のテストケースを追加 (timeout 1 回呼び / catch 経路リトライ成功 / catch 経路リトライ失敗)
  tests/provider.test.ts                 [PoC 成功時のみ] Agent.create モックが local: { cwd } を含む引数で呼ばれることを検証
unchanged (本計画では変更しない):
  src/agent-pool.ts                      現行 PooledAgent / tryGet / put / evictIfNeeded を維持
  src/auth.ts, config.ts, errors.ts, git.ts, logger.ts, models.ts, pkce.ts, stream-proxy.ts, translator.ts
  tsconfig.json, vitest.config.ts, biome.json
  .github/workflows/ci.yml               既に ubuntu-slim / master トリガー / Node 20 / pnpm 9.12.0 が設定済み
PoC scratch (コミットしない):
  scripts/poc-agent-local-mode.ts        Phase 2 の判定後に削除
```

---

## Git ブランチ運用サマリー

| Phase | Phase Base ブランチ (派生元: `master`) | 完了時 Draft PR ターゲット |
|---|---|---|
| Phase 1 | `feature/phase1_devcontainer-tooling__base` | `master` |
| Phase 2 | `feature/phase2_poc-local-mode__base` | `master` |
| Phase 3 | `feature/phase3_dispose-hardening__base` | `master` |
| Phase 4 | `feature/phase4_agent-create-finalization__base` | `master` |

各 Task のブランチは原則 Phase Base から派生し、独立性が確保できない場合のみ直前 Task から派生します（各 Task 冒頭に明記）。各 Task 完了時、Phase Base をターゲットとした Draft PR を作成します。**Task ブランチを Phase Base にはマージしません**（PR レビュー後、Phase Base を `master` にマージするタイミングで一括取り込み）。

Phase は順次進行とし、前 Phase の PR が `master` にマージされてから次 Phase を開始します。

> **順次進行とする根拠:**
> - **Phase 1 → Phase 2:** Phase 2 の PoC スクリプトは Node 20 Devcontainer 内 (`pnpm dlx tsx ...`) かつ `remoteEnv.CURSOR_API_KEY` 注入を前提とするため、Phase 1 Task 1.1 で更新する Devcontainer に依存する。
> - **Phase 2 → Phase 3:** Phase 3 は PoC 結果に依存しないため理論上は並走可能だが、PoC 失敗時の方針切替（Phase 4 縮退）と Phase 3 のレビュー集中を競合させないため逐次進行を選択。
> - **Phase 3 → Phase 4:** Phase 4 Task 4.2 は Phase 2 PoC 結果による分岐に加え、Phase 3 の `agent-cleanup` 改修と同じ呼び出し経路（`Agent.create` ↔ `disposeAgentSafely`）に触れるため、衝突回避のため逐次進行とする。

---

## Phase 1: Devcontainer & 開発ツーリングの整備

Phase Base ブランチ `feature/phase1_devcontainer-tooling__base` を `master` から作成します。

### Phase 1 セットアップ

- [x] **Step P1.0: Phase Base ブランチを作成**

```bash
git fetch origin
git checkout master
git pull --ff-only origin master
git checkout -b feature/phase1_devcontainer-tooling__base
git push -u origin feature/phase1_devcontainer-tooling__base
```

### Task 1.1: Devcontainer の Node 20 ベースイメージ化と設定強化

**派生元判定:** 独立タスク → `feature/phase1_devcontainer-tooling__base` から派生。
**ブランチ:** `feature/phase1-task1_devcontainer-update`

**Files:**
- Modify: `.devcontainer/Dockerfile`
- Modify: `.devcontainer/devcontainer.json`

- [x] **Step 1: Task ブランチを作成**

```bash
git checkout feature/phase1_devcontainer-tooling__base
git pull --ff-only origin feature/phase1_devcontainer-tooling__base
git checkout -b feature/phase1-task1_devcontainer-update
```

- [x] **Step 2: Dockerfile を javascript-node:20 ベースに書き換える**

`.devcontainer/Dockerfile` を以下に置換する。

```dockerfile
FROM mcr.microsoft.com/devcontainers/javascript-node:20

RUN corepack enable \
 && corepack prepare pnpm@9.12.0 --activate \
 && [ "$(pnpm --version)" = "9.12.0" ] \
 && node --version | grep -E '^v20\.' >/dev/null

USER node
```

- [x] **Step 3: devcontainer.json を更新（Node20 ガード + 拡張機能/設定）**

`.devcontainer/devcontainer.json` を以下に置換する。

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

- [x] **Step 4: Devcontainer を再ビルドして起動を検証する**

Devcontainer 拡張から `Dev Containers: Rebuild Container` を実行する。
（CLI 利用時: `devcontainer up --workspace-folder . --remove-existing-container`）

期待: ビルドが成功し、コンテナ内のシェルで以下が成立する。

```bash
node --version    # → v20.x.x
pnpm --version    # → 9.12.0
```

- [x] **Step 5: Devcontainer 内で既存スクリプトの動作を確認する**

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
```

期待: 3 コマンドすべて exit code 0 で終了。

- [x] **Step 6: コミット**

```bash
git add .devcontainer/Dockerfile .devcontainer/devcontainer.json
git commit -m "chore(devcontainer): Node20 ベースイメージへ移行し postCreate に Node バージョンガードを追加"
git push -u origin feature/phase1-task1_devcontainer-update
```

- [x] **Step 7: Phase Base に向けた Draft PR を作成**

```bash
gh pr create --draft \
  --base feature/phase1_devcontainer-tooling__base \
  --head feature/phase1-task1_devcontainer-update \
  --title "chore(devcontainer): Node20 ベースイメージ化と postCreate Node バージョンガード" \
  --body "$(cat <<'EOF'
## Summary
- Devcontainer Dockerfile を `javascript-node:20` に切り替え、pnpm/Node のバージョン整合性をビルド時にフェイルファスト検証
- devcontainer.json で Biome / Vitest Explorer 拡張を有効化し、postCreate に Node 20 ガードを追加

## Test plan
- [x] Devcontainer を再ビルドし、コンテナ内で `node --version` が v20 系であることを確認
- [x] Devcontainer 内で `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test` がすべて成功すること

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

### Task 1.2: Biome 本体の devDependencies 追加と lint スクリプト追加

**派生元判定:** 独立タスク → `feature/phase1_devcontainer-tooling__base` から派生。
**ブランチ:** `feature/phase1-task2_biome-lint-script`

**Files:**
- Modify: `package.json`
- (lock 更新): `pnpm-lock.yaml`

- [x] **Step 1: Task ブランチを作成**

```bash
git checkout feature/phase1_devcontainer-tooling__base
git pull --ff-only origin feature/phase1_devcontainer-tooling__base
git checkout -b feature/phase1-task2_biome-lint-script
```

- [x] **Step 2: Devcontainer 内で Biome を devDependency として追加**

Devcontainer 内シェルで実行する。

```bash
pnpm add -D @biomejs/biome@^1.9.4
```

- [x] **Step 3: package.json に lint スクリプトを追加**

`package.json` の `scripts` セクションに `"lint": "biome ci ."` を `typecheck` の直後に追加する。最終形:

```jsonc
{
  "scripts": {
    "build": "tsc --project tsconfig.json --outDir dist --noEmit false",
    "prepublishOnly": "pnpm build",
    "typecheck": "tsc --noEmit",
    "lint": "biome ci .",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "bash scripts/e2e-cursor-provider.sh"
  }
}
```

- [x] **Step 4: Devcontainer 内で lint を実行し PASSすることを確認**

```bash
pnpm lint
```

期待: Biome の `ci` モードで現状の `biome.json` に従い問題なく終了 (exit 0)。
（既存ファイルで違反が発覚した場合は本 Task ではなく別途修正 PR を作成すること。本 Task の責務はスクリプト追加のみ。違反があった場合は **PR 説明欄に明記** し、後続フォロー扱いとしてレビュアに判断を仰ぐ。）

- [x] **Step 5: 型検査とテストにリグレッションがないことを確認**

```bash
pnpm typecheck
pnpm test
```

期待: いずれも exit 0。

- [x] **Step 6: コミット**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore(deps): @biomejs/biome を devDependencies に追加し pnpm lint スクリプトを追加"
git push -u origin feature/phase1-task2_biome-lint-script
```

- [x] **Step 7: Phase Base に向けた Draft PR を作成**

```bash
gh pr create --draft \
  --base feature/phase1_devcontainer-tooling__base \
  --head feature/phase1-task2_biome-lint-script \
  --title "chore(deps): Biome を devDependencies に追加し lint スクリプトを公開" \
  --body "$(cat <<'EOF'
## Summary
- `@biomejs/biome@^1.9.4` を devDependencies に追加
- `package.json#scripts` に `lint: biome ci .` を追加し、Devcontainer 内 / CI で再現可能な静的解析手段を提供

## Test plan
- [x] Devcontainer 内で `pnpm lint` が exit 0 で終了
- [x] `pnpm typecheck` / `pnpm test` にリグレッションがないこと

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

### Task 1.3: AGENTS.md / README.md の Devcontainer 必須化記述

**派生元判定:** 独立タスク (ドキュメントのみ、コードに依存しない) → `feature/phase1_devcontainer-tooling__base` から派生。
**ブランチ:** `feature/phase1-task3_docs-devcontainer-required`

**Files:**
- Modify: `AGENTS.md`
- Modify: `README.md`

- [x] **Step 1: Task ブランチを作成**

```bash
git checkout feature/phase1_devcontainer-tooling__base
git pull --ff-only origin feature/phase1_devcontainer-tooling__base
git checkout -b feature/phase1-task3_docs-devcontainer-required
```

- [x] **Step 2: AGENTS.md の `<commands>` セクションを Devcontainer 必須に書き換える**

`AGENTS.md` 17 行目（"To verify your changes..." を含む文）を以下の文に置換する。

置換前:
```text
To verify your changes, please use the following commands. Ideally, these should be run inside the provided Devcontainer (`.devcontainer/`).
```

置換後:
```text
To verify your changes, please use the following commands. **Required:** these MUST be run inside the provided Devcontainer (`.devcontainer/`) for native module (`sqlite3`) reproducibility. Running them on the host OS is not accepted as evidence in PR reviews.
```

- [x] **Step 3: README.md の開発者向けセクションに Devcontainer 必須化を追記**

`README.md` の「開発」「Development」「Contributing」相当のセクションに以下の段落を追加（該当セクションがない場合は末尾近くに新規セクションを作成）。

```markdown
### 開発環境 (Required)

ローカル開発・テスト・静的解析はすべて `.devcontainer/` の Devcontainer 内で実行してください。Node.js 20+ と `sqlite3` ネイティブモジュールの再現性を保つため、ホスト OS 上での `pnpm test` / `pnpm typecheck` / `pnpm lint` の実行はレビュー時のエビデンスとして採用されません。

- VS Code / Cursor: コマンドパレットから `Dev Containers: Reopen in Container`
- CLI: `devcontainer up --workspace-folder .` 後、`devcontainer exec --workspace-folder . pnpm <command>`
```

- [x] **Step 4: Devcontainer 内で Lint と型検査を実行（リグレッション確認）**

```bash
pnpm lint
pnpm typecheck
```

期待: 両方とも exit 0。

- [x] **Step 5: コミット**

```bash
git add AGENTS.md README.md
git commit -m "docs: Devcontainer 内での pnpm 実行を必須化する旨を AGENTS.md / README.md に明記"
git push -u origin feature/phase1-task3_docs-devcontainer-required
```

- [x] **Step 6: Phase Base に向けた Draft PR を作成**

```bash
gh pr create --draft \
  --base feature/phase1_devcontainer-tooling__base \
  --head feature/phase1-task3_docs-devcontainer-required \
  --title "docs: pnpm 実行は Devcontainer 内必須を AGENTS.md / README.md に明記" \
  --body "$(cat <<'EOF'
## Summary
- AGENTS.md `<commands>` セクションを "Ideally" → "**Required:** MUST be run inside Devcontainer" に強化
- README.md の開発者向けセクションに Devcontainer 必須化と起動手順を追記

## Test plan
- [x] Devcontainer 内で `pnpm lint` / `pnpm typecheck` がいずれも exit 0
- [x] AGENTS.md / README.md の差分が意図通りであること（レビュー）

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

### Phase 1 完了処理

- [x] **Step P1.X: Phase Base の Draft PR を `master` に対して作成**

`feature/phase1_devcontainer-tooling__base` から `master` への Draft PR を作成する。Task 1.1 / 1.2 / 1.3 の差分が個別 PR としてレビュー済みであることをコメントに記載する。

```bash
git checkout feature/phase1_devcontainer-tooling__base
git push origin feature/phase1_devcontainer-tooling__base
gh pr create --draft \
  --base master \
  --head feature/phase1_devcontainer-tooling__base \
  --title "feat(phase1): Devcontainer 整備 & 開発ツーリング (Biome / Devcontainer 必須化)" \
  --body "$(cat <<'EOF'
## Summary
- Devcontainer ベースイメージを `javascript-node:20` に統一し、Node 20 ガード/拡張機能を整備
- Biome を devDependency 化し `pnpm lint` を公開
- AGENTS.md / README.md に Devcontainer 内検証を必須として記載

レビュー粒度を保つため Task ブランチ単位の個別 Draft PR を併走させています:
- #<TASK1_PR>
- #<TASK2_PR>
- #<TASK3_PR>

## Test plan
- [x] Devcontainer 内で `pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm test` が成功する

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Phase 1 の `master` マージ後に Phase 2 を開始してください。

---

## Phase 2: PoC ゲート (Agent.create `local: { cwd }` の受理確認)

設計書 §3.3 のとおり、`@cursor/sdk@1.0.12` が `local` オプションを受理するかは公開型に未定義のため、実装前に PoC で確認します。本 Phase の判定結果が Phase 4 の実装スコープ（主案 / フォールバック）を決定します。

Phase Base ブランチ `feature/phase2_poc-local-mode__base` を `master` から作成します。

### Phase 2 セットアップ

- [x] **Step P2.0: Phase Base ブランチを作成**

```bash
git fetch origin
git checkout master
git pull --ff-only origin master
git checkout -b feature/phase2_poc-local-mode__base
git push -u origin feature/phase2_poc-local-mode__base
```

### Task 2.1: PoC スクリプト作成・実行・判定・撤収

**派生元判定:** 単一タスク → `feature/phase2_poc-local-mode__base` から派生。
**ブランチ:** `feature/phase2-task1_poc-local-mode-gate`

**Files:**
- Create (一時): `scripts/poc-agent-local-mode.ts`（**コミットしない**。最終的に削除する）
- (No production files modified)

- [x] **Step 1: Task ブランチを作成**

```bash
git checkout feature/phase2_poc-local-mode__base
git pull --ff-only origin feature/phase2_poc-local-mode__base
git checkout -b feature/phase2-task1_poc-local-mode-gate
```

- [x] **Step 2: PoC スクリプトを作成**

`scripts/poc-agent-local-mode.ts` を以下の内容で作成する。

```ts
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

- [x] **Step 3: Devcontainer 内で PoC を実行する**

Devcontainer 内シェルで実行する（`CURSOR_API_KEY` は `remoteEnv` で注入される）。本 Devcontainer は Node 20 系で固定（Phase 1 Task 1.1）のため、TypeScript 直接実行には `tsx` を `pnpm dlx` 経由で利用する。

```bash
pnpm dlx tsx scripts/poc-agent-local-mode.ts 2>&1 | tee poc-output.log
echo "EXIT=$?"
```

> `--experimental-strip-types` は Node v22.6.0 以降でのみ利用可能なため、本計画の Devcontainer（Node 20）では使用不可。`tsx` を恒久的に追加すると設計書 §4.2 の `devDependencies` 一覧と乖離するため、本 PoC では `pnpm dlx` でその場利用にとどめる（PoC スクリプトと同様、依存追加もコミットしない）。実行コマンドと出力は PR 説明欄に転記する。

- [x] **Step 4: 結果を判定し記録する**

| 観測 | 判定 |
|---|---|
| `STATUS= finished` が出力され、プロセスが exit 0 で終了 | **[x] PoC 成功** → Phase 4 は主案 (local 明示) を採用 |
| `Agent.create` が throw / `TypeError: Unknown option "local"` 等の型・引数エラー | **[ ] PoC 失敗** → Phase 4 はフォールバック (local 無指定) を採用 |
| segfault / SIGSEGV / プロセスクラッシュ | **[ ] PoC 失敗** → 同上 |

判定結果を `poc-output.log` のスニペットと共に Markdown でまとめ、Step 7 の PR 説明欄に貼り付ける。

- [x] **Step 5: PoC スクリプトと一時ログを削除する**

削除前に `git status` で `poc-output.log` および `scripts/poc-agent-local-mode.ts` がステージングされていないことを確認する（誤コミット防止）。

```bash
git status --short   # poc-output.log / scripts/poc-agent-local-mode.ts は untracked のままであること
rm scripts/poc-agent-local-mode.ts poc-output.log
```

- [x] **Step 6: 差分が空であることを確認しコミット（または空のままにする）**

PoC は本番コードに痕跡を残さない方針のため、`git status` でステージング対象がないことを確認する。

```bash
git status   # → "nothing to commit, working tree clean" を期待
```

判定エビデンスはコードではなく PR 説明欄に残す（Step 7）。

- [x] **Step 7: Phase Base に向けた Draft PR を作成（エビデンス転記用）**

Phase 2 はコード差分を残さないため、PR は「エビデンスドキュメントの保管庫」として機能する。空コミットでも PR を作る:

```bash
git checkout feature/phase2-task1_poc-local-mode-gate
git commit --allow-empty -m "chore(poc): Agent.create local mode 受理確認 (エビデンスは PR 説明欄に記録)"
git push -u origin feature/phase2-task1_poc-local-mode-gate

gh pr create --draft \
  --base feature/phase2_poc-local-mode__base \
  --head feature/phase2-task1_poc-local-mode-gate \
  --title "chore(poc): Agent.create local: { cwd } 受理判定" \
  --body "$(cat <<'EOF'
## PoC 結果

- 実行コマンド: `<記入>`
- 実行環境: Devcontainer (javascript-node:20)
- 観測ログ抜粋:

```text
<poc-output.log の冒頭・末尾を貼付>
```

## 判定

- [x] PoC 成功 (`STATUS= finished` 観測) → Phase 4 は **主案** を採用 (`local: { cwd: process.cwd() }` を `Agent.create` に明示)
- [ ] PoC 失敗 → Phase 4 は **フォールバック** を採用 (`local` 無指定 / 現状維持)。`tests/integration/` 配下に SDK アップグレード時に再 PoC 実施を促す回帰検知テストを後続 Phase で追加検討

## Files
- 本 PR はコード差分を残しません（PoC スクリプトはコミット前に削除済）。

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

### Phase 2 完了処理

- [x] **Step P2.X: Phase Base の Draft PR を `master` に対して作成**

```bash
git checkout feature/phase2_poc-local-mode__base
git push origin feature/phase2_poc-local-mode__base
gh pr create --draft \
  --base master \
  --head feature/phase2_poc-local-mode__base \
  --title "feat(phase2): Agent.create local mode の PoC 判定" \
  --body "Phase 4 実装方針を決定するための PoC ゲート。詳細エビデンスは #<TASK_PR> 参照。"
```

Phase 2 の `master` マージ後の進め方は次のとおり（**Phase 3 → Phase 4 の順を厳守**）:

1. **PoC 判定結果を記録のみ行う**（コード変更は行わない）。記録先は Phase 2 PR 説明欄と、Phase 4 開始時に参照できる場所（PR コメント転記やプロジェクトメモ等）。
2. **Phase 3 を先に着手・完了** させる（PoC 結果に依存せず独立して実装可能）。
3. **Phase 4 の実作業は Phase 3 が `master` にマージされた後に着手** し、開始時点で 1. に記録した PoC 判定結果を参照して主案 / フォールバックを選択する（Task 4.2 冒頭の判定ステップで実施）。

---

## Phase 3: Dispose ライフサイクル堅牢化

設計書 §4.5 / §5 のとおり、`disposeAgentSafely` を「タイムアウト = リトライ禁止 / 例外 = 200ms 猶予後に 1 回リトライ」の非対称設計に改修します。`PooledAgent` 構造は変更しません（設計書 §4.4）。

Phase Base ブランチ `feature/phase3_dispose-hardening__base` を `master` から作成します。

### Phase 3 セットアップ

- [x] **Step P3.0: Phase Base ブランチを作成**

```bash
git fetch origin
git checkout master
git pull --ff-only origin master
git checkout -b feature/phase3_dispose-hardening__base
git push -u origin feature/phase3_dispose-hardening__base
```

### Task 3.1: agent-cleanup のテスト先行記述 (TDD red)

**派生元判定:** 独立タスク → `feature/phase3_dispose-hardening__base` から派生。
**ブランチ:** `feature/phase3-task1_dispose-tests-red`

**Files:**
- Modify: `tests/agent-cleanup.test.ts`

- [x] **Step 1: Task ブランチを作成**

```bash
git checkout feature/phase3_dispose-hardening__base
git pull --ff-only origin feature/phase3_dispose-hardening__base
git checkout -b feature/phase3-task1_dispose-tests-red
```

- [x] **Step 2: テストケースを追記**

`tests/agent-cleanup.test.ts` の `describe("disposeAgentSafely", ...)` ブロック内、既存テストの直後に以下を追加する（既存テストは残す）。

```ts
  it("タイムアウト経路: 1 回目で resolve せずリトライもしない (Symbol.asyncDispose 呼び出しは 1 回のみ)", async () => {
    const rawLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const log = createLogger(rawLog);
    const disposeFn = vi.fn(() => new Promise<void>(() => {})); // 永久 pending
    const agent = { [Symbol.asyncDispose]: disposeFn } as any;

    const result = disposeAgentSafely(agent, log);

    vi.advanceTimersByTime(5_000); // DISPOSE_TIMEOUT_MS
    await expect(result).resolves.toBeUndefined();

    expect(disposeFn).toHaveBeenCalledTimes(1);
    expect(rawLog.warn).toHaveBeenCalledWith(
      expect.stringContaining("agent dispose timed out; not retrying"),
      expect.objectContaining({ timeoutMs: 5_000 }),
    );
  });

  it("catch 経路: 1 回目 reject → RETRY_DELAY_MS 待機 → 2 回目で resolve すれば成功", async () => {
    const rawLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const log = createLogger(rawLog);
    const disposeFn = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("boom"))
      .mockResolvedValueOnce(undefined);
    const agent = { [Symbol.asyncDispose]: disposeFn } as any;

    const result = disposeAgentSafely(agent, log);

    await vi.advanceTimersByTimeAsync(200); // RETRY_DELAY_MS
    await expect(result).resolves.toBeUndefined();

    expect(disposeFn).toHaveBeenCalledTimes(2);
    expect(rawLog.warn).toHaveBeenCalledWith(
      expect.stringContaining("agent dispose failed; retrying once"),
      expect.objectContaining({ errorType: "TypeError" }),
    );
  });

  it("catch 経路: リトライも reject した場合は warn のみで例外を伝播しない", async () => {
    const rawLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const log = createLogger(rawLog);
    const disposeFn = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("boom1"))
      .mockRejectedValueOnce(new TypeError("boom2"));
    const agent = { [Symbol.asyncDispose]: disposeFn } as any;

    const result = disposeAgentSafely(agent, log);

    await vi.advanceTimersByTimeAsync(200);
    await expect(result).resolves.toBeUndefined();

    expect(disposeFn).toHaveBeenCalledTimes(2);
    expect(rawLog.warn).toHaveBeenCalledWith(
      expect.stringContaining("agent dispose retry failed"),
      expect.objectContaining({ errorType: "TypeError" }),
    );
  });
```

- [x] **Step 3: テストを実行し、追加分が FAIL することを確認 (Red)**

Devcontainer 内で実行する。

```bash
pnpm test tests/agent-cleanup.test.ts
```

期待: 既存 3 ケースは PASS、追加した 3 ケース（タイムアウト 1 回呼び / catch 経路リトライ成功 / catch 経路リトライ失敗）は FAIL する。失敗内容は `expect(rawLog.warn).toHaveBeenCalledWith(...)` のメッセージ一致失敗および呼び出し回数の不一致を想定。

- [x] **Step 4: コミット**

```bash
git add tests/agent-cleanup.test.ts
git commit -m "test(agent-cleanup): 非対称リトライ設計のテストを先行追加 (TDD red)"
git push -u origin feature/phase3-task1_dispose-tests-red
```

- [x] **Step 5: Phase Base に向けた Draft PR を作成**

```bash
gh pr create --draft \
  --base feature/phase3_dispose-hardening__base \
  --head feature/phase3-task1_dispose-tests-red \
  --title "test(agent-cleanup): dispose 非対称リトライ設計の Red テスト追加" \
  --body "$(cat <<'EOF'
## Summary
- 設計書 §4.5 の非対称設計 (timeout = リトライ禁止 / catch = 1 回リトライ) を担保するテストを追加
- 本 PR 単独ではテストは FAIL する想定 (TDD red)。実装は Task 3.2 で対応

## Test plan
- [x] Devcontainer 内で `pnpm test tests/agent-cleanup.test.ts` を実行し、追加した 3 ケースが FAIL することを確認

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

### Task 3.2: agent-cleanup.ts 本体の非対称リトライ実装 (TDD green)

**派生元判定:** 依存タスク (Task 3.1 のテストが緑になることをゴールとする) → `feature/phase3-task1_dispose-tests-red` から派生。
**ブランチ:** `feature/phase3-task2_dispose-impl`

**Files:**
- Modify: `src/agent-cleanup.ts`

- [x] **Step 1: Task ブランチを作成（直前 Task から派生）**

```bash
git checkout feature/phase3-task1_dispose-tests-red
git pull --ff-only origin feature/phase3-task1_dispose-tests-red
git checkout -b feature/phase3-task2_dispose-impl
```

- [x] **Step 2: `src/agent-cleanup.ts` を全面書き換え**

`src/agent-cleanup.ts` を以下に置換する（設計書 §4.5 そのまま）。

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
    // Symbol.asyncDispose はブラケット記法必須 (言語仕様)。
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
      // NOTE: タイムアウト時はネイティブ側 (sqlite3 など) がロック保持・close 進行中の可能性が
      // 高く、再度 [Symbol.asyncDispose]() を呼ぶと二重解放 / use-after-free を誘発しうる。
      // よってリトライせず、警告ログのみで握り潰す (プロセスは継続)。
      log.warn("cursor-provider: agent dispose timed out; not retrying (native lock risk)", {
        timeoutMs: DISPOSE_TIMEOUT_MS,
      });
    }
  } catch (err) {
    // 例外 reject の場合は dispose 呼び出しが確定的に決着しているため、
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

- [x] **Step 3: テストを実行し全件 PASS することを確認 (Green)**

Devcontainer 内で実行する。

```bash
pnpm test tests/agent-cleanup.test.ts
```

期待: 既存 3 ケース + 追加 3 ケース = 計 6 ケースすべて PASS。

- [x] **Step 4: 全体のリグレッション検査**

```bash
pnpm typecheck
pnpm lint
pnpm test
```

期待: 3 コマンドすべて exit 0。

- [x] **Step 5: コミット**

```bash
git add src/agent-cleanup.ts
git commit -m "refactor(agent-cleanup): timeout 経路はリトライ禁止 / catch 経路で 200ms 後に 1 回リトライ"
git push -u origin feature/phase3-task2_dispose-impl
```

- [x] **Step 6: Phase Base に向けた Draft PR を作成**

```bash
gh pr create --draft \
  --base feature/phase3_dispose-hardening__base \
  --head feature/phase3-task2_dispose-impl \
  --title "refactor(agent-cleanup): dispose 非対称リトライ実装 (TDD green)" \
  --body "$(cat <<'EOF'
## Summary
- 設計書 §4.5 の非対称設計を実装: タイムアウト経路はリトライ禁止 (native ロック中の二重解放回避)、catch 経路は 200ms 猶予後に 1 回リトライ
- 新規 export: `RETRY_DELAY_MS = 200`
- Task 3.1 で追加した 3 ケースを含む全 6 ケースが PASS することを確認

## Test plan
- [x] Devcontainer 内で `pnpm test tests/agent-cleanup.test.ts` の全 6 ケース PASS
- [x] Devcontainer 内で `pnpm typecheck && pnpm lint && pnpm test` がすべて exit 0

## 依存
- 本 PR は Task 3.1 (`feature/phase3-task1_dispose-tests-red`) に積み上げています。Phase Base マージ時に同時取り込みを想定。

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

### Phase 3 完了処理

- [x] **Step P3.X: Phase Base の Draft PR を `master` に対して作成**

```bash
git checkout feature/phase3_dispose-hardening__base
git push origin feature/phase3_dispose-hardening__base
gh pr create --draft \
  --base master \
  --head feature/phase3_dispose-hardening__base \
  --title "feat(phase3): Agent dispose ライフサイクルの堅牢化" \
  --body "$(cat <<'EOF'
## Summary
- Task 3.1 (#<PR>): 非対称リトライの Red テスト追加
- Task 3.2 (#<PR>): timeout = リトライ禁止 / catch = 1 回リトライの実装

## Test plan
- [x] Devcontainer 内で `pnpm typecheck && pnpm lint && pnpm test` が成功する

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Phase 4: Pool 容量調整 & `Agent.create` local オプション (条件付き)

Phase Base ブランチ `feature/phase4_agent-create-finalization__base` を `master` から作成します。

Task 4.2 の実装内容は Phase 2 の PoC 判定結果に応じて切り替わります（設計書 §3.3 フォールバック設計）。本計画では **PoC 成功時 = 主案** をメインに記述し、Task 4.2 の冒頭で「PoC 失敗時は本 Task をスキップ」と明記します。

### Phase 4 セットアップ

- [x] **Step P4.0: Phase Base ブランチを作成**

```bash
git fetch origin
git checkout master
git pull --ff-only origin master
git checkout -b feature/phase4_agent-create-finalization__base
git push -u origin feature/phase4_agent-create-finalization__base
```

### Task 4.1: `POOL_CAPACITY` を 8 → 10 に引き上げる

**派生元判定:** 独立タスク (PoC 結果に依存せず、`src/index.ts` の定数 1 箇所のみの変更) → `feature/phase4_agent-create-finalization__base` から派生。
**ブランチ:** `feature/phase4-task1_pool-capacity-10`

**Files:**
- Modify: `src/index.ts` (11 行目)

- [x] **Step 1: Task ブランチを作成**

```bash
git checkout feature/phase4_agent-create-finalization__base
git pull --ff-only origin feature/phase4_agent-create-finalization__base
git checkout -b feature/phase4-task1_pool-capacity-10
```

- [x] **Step 2: `src/index.ts` の定数を書き換える**

`src/index.ts:11` を以下のとおり書き換える。

置換前:
```ts
const POOL_CAPACITY = 8;
```

置換後:
```ts
const POOL_CAPACITY = 10; // Node 20 移行で生成・破棄サイクルを緩和し、sqlite3 dispose 競合を抑制
```

- [x] **Step 3: Devcontainer 内で型検査・Lint・テストを実行**

```bash
pnpm typecheck
pnpm lint
pnpm test
```

期待: 3 コマンドすべて exit 0。

- [x] **Step 4: コミット**

```bash
git add src/index.ts
git commit -m "perf(agent-pool): POOL_CAPACITY を 8 → 10 に引き上げ dispose レース緩和"
git push -u origin feature/phase4-task1_pool-capacity-10
```

- [x] **Step 5: Phase Base に向けた Draft PR を作成**

```bash
gh pr create --draft \
  --base feature/phase4_agent-create-finalization__base \
  --head feature/phase4-task1_pool-capacity-10 \
  --title "perf(agent-pool): POOL_CAPACITY 8 → 10" \
  --body "$(cat <<'EOF'
## Summary
- `src/index.ts` の `POOL_CAPACITY` を 10 に引き上げ、agent の生成・破棄頻度を低減して `sqlite3` dispose 競合を緩和

## Test plan
- [x] Devcontainer 内で `pnpm typecheck && pnpm lint && pnpm test` が成功

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

### Task 4.2: `Agent.create` への `local: { cwd: process.cwd() }` 明示 (PoC 成功時のみ)

**派生元判定:** 独立タスク (`src/openai-proxy.ts` と `src/provider.ts` の Agent.create 呼び出しおよび `tests/provider.test.ts` を一括変更。Task 4.1 と独立) → `feature/phase4_agent-create-finalization__base` から派生。
**ブランチ:** `feature/phase4-task2_agent-create-local-mode`

> [!IMPORTANT]
> **Phase 2 で PoC が失敗していた場合、本 Task はスキップ** してください（設計書 §3.3 フォールバック）。スキップする場合、Phase 4 完了処理の PR 説明欄に「PoC 失敗のため `local: { cwd }` 追加は本リリースでは見送り、Task 4.1 のみ取り込み」と明記し、`tests/integration/` に SDK アップデート時の回帰検知テストを追加するチケットを別途起票してください。

**Files (PoC 成功時):**
- Modify: `src/openai-proxy.ts` (162-165 行付近)
- Modify: `src/provider.ts` (316, 325, 345 行付近: `performAgentCreationAttempt` 周辺)
- Modify: `tests/provider.test.ts` (Agent.create モックの引数アサート箇所)
- Modify: `tests/integration/provider-flow.test.ts` (モックが `local` を受理するよう調整 / 必要時のみ)

- [x] **Step 1: PoC 結果を確認**

Phase 2 PR の判定結果を確認する。「PoC 成功」でない場合は本 Task をスキップ。

- [x] **Step 2: Task ブランチを作成**

```bash
git checkout feature/phase4_agent-create-finalization__base
git pull --ff-only origin feature/phase4_agent-create-finalization__base
git checkout -b feature/phase4-task2_agent-create-local-mode
```

- [x] **Step 3: 先にテストを更新する (TDD red)**

`tests/provider.test.ts` 内で `Agent.create` のモック呼び出しを検証している箇所を特定し、引数アサートに `local: { cwd: <現在の作業ディレクトリ> }` の検証を追加する。テスト中で `process.cwd()` の評価タイミングが本体と一致するように `expect.objectContaining({ apiKey: expect.any(String), model: { id: expect.any(String) }, local: { cwd: process.cwd() } })` を使う。

挿入箇所例 (`tests/provider.test.ts` 内の `Agent.create` mock を検証している `it` ブロックを特定):

```ts
expect(AgentMock.create).toHaveBeenCalledWith(
  expect.objectContaining({
    apiKey: expect.any(String),
    model: expect.objectContaining({ id: expect.any(String) }),
    local: { cwd: process.cwd() },
  }),
);
```

該当 `it` ブロックが複数ある場合はすべてに同等のアサートを追加する。

- [x] **Step 4: テストを実行し、追加分が FAIL することを確認 (Red)**

```bash
pnpm test tests/provider.test.ts
```

期待: `local: { cwd }` を要求するアサートが FAIL する。

- [x] **Step 5: `src/openai-proxy.ts` の `Agent.create` 呼び出しを更新**

`src/openai-proxy.ts:160-165` の `Agent.create` 呼び出しを以下に置換する。

置換前:
```ts
        log.debug("cursor-openai-proxy: calling Agent.create (local mode)", { modelId });

        agent = await Agent.create({
          apiKey,
          model: { id: modelId },
        });
```

置換後:
```ts
        log.debug("cursor-openai-proxy: calling Agent.create (local mode)", { modelId });

        // NOTE: Node.js 移行に伴い、@cursor/sdk の Agent.create には実行モードを明示する。
        // 履歴: 081f9c6 で cloud 実行に切替 → 876ead0 で空 cloud:{} を削除 (Bun 互換性問題)。
        // 現在は Node 20 環境で local モードに固定し、cwd を明示することでネイティブモジュール
        // (sqlite3) のワーキングディレクトリ解決を堅牢化する。
        // @cursor/sdk@1.0.12 時点では undocumented option のため、SDK 更新時に再確認が必要。
        agent = await Agent.create({
          apiKey,
          model: { id: modelId },
          local: { cwd: process.cwd() },
        });
```

- [x] **Step 6: `src/provider.ts` の型と呼び出しを拡張**

`src/provider.ts` の `performAgentCreationAttempt` 周辺 (line 313-345 付近) を以下のとおり改修する。

(a) 関数引数の型を `AgentCreateOpts` を取り出した形に揃える。`performAgentCreationAttempt` の `Agent` 引数の型を以下のように書き換える:

置換前 (316 行付近):
```ts
  Agent: { create: (opts: { apiKey: string; model: { id: string } }) => Promise<unknown> };
```

置換後:
```ts
  Agent: { create: (opts: AgentCreateOpts) => Promise<unknown> };
```

(b) 関数定義の直前 (313 行付近、`async function performAgentCreationAttempt` の直前) に型定義を追加:

```ts
type AgentCreateOpts = {
  apiKey: string;
  model: { id: string };
  local: { cwd: string };
};
```

(c) 関数本体の `Agent.create` 呼び出し (325 行) を以下に置換:

置換前:
```ts
    const agent = (await Agent.create({ apiKey, model: { id: modelId } })) as SDKAgent;
```

置換後:
```ts
    // NOTE: 詳細は src/openai-proxy.ts の同等コメント参照。
    const agent = (await Agent.create({
      apiKey,
      model: { id: modelId },
      local: { cwd: process.cwd() },
    })) as SDKAgent;
```

(d) `createAgentWithRetry` 内の `Agent` キャスト (345 行付近) を `AgentCreateOpts` 互換に揃える:

置換前:
```ts
    const result = await performAgentCreationAttempt({ Agent: Agent as unknown as { create: (opts: { apiKey: string; model: { id: string } }) => Promise<unknown> }, ...deps, attempt });
```

置換後:
```ts
    const result = await performAgentCreationAttempt({ Agent: Agent as unknown as { create: (opts: AgentCreateOpts) => Promise<unknown> }, ...deps, attempt });
```

- [x] **Step 7: 統合テストモックを必要に応じて調整**

`tests/integration/provider-flow.test.ts` の `Agent.create` モックが追加プロパティ `local` を受理する形になっているか確認する（`vi.fn().mockResolvedValue(...)` 形式であれば追加対応不要）。引数のシグネチャをチェックしているモックがある場合のみ修正する。

```bash
pnpm test tests/integration/provider-flow.test.ts
```

期待: PASS。FAIL する場合のみモック側を `expect.objectContaining` ベースに緩める。

> **注意:** 本 Step で `tests/integration/provider-flow.test.ts` を変更した場合のみ、Step 9 の `git add` 対象に同ファイルを含めること。未変更の場合は `git add` 対象から外す。

- [x] **Step 8: 全テストが PASS することを確認 (Green)**

```bash
pnpm typecheck
pnpm lint
pnpm test
```

期待: 3 コマンドすべて exit 0。

- [x] **Step 9: コミット**

Step 7 で `tests/integration/provider-flow.test.ts` に変更を加えた場合のみ、同ファイルを `git add` 対象に含める（未変更なら外す）。

```bash
# 必須: 本 Task で必ず変更されるファイル
git add src/openai-proxy.ts src/provider.ts tests/provider.test.ts
# 条件付き: Step 7 で実際に変更を加えた場合のみ追加
# git add tests/integration/provider-flow.test.ts
git commit -m "feat(agent): Agent.create に local: { cwd: process.cwd() } を明示しネイティブ cwd 解決を堅牢化"
git push -u origin feature/phase4-task2_agent-create-local-mode
```

- [x] **Step 10: Phase Base に向けた Draft PR を作成**

```bash
gh pr create --draft \
  --base feature/phase4_agent-create-finalization__base \
  --head feature/phase4-task2_agent-create-local-mode \
  --title "feat(agent): Agent.create に local: { cwd } を明示 (PoC 成功を受けて採用)" \
  --body "$(cat <<'EOF'
## Summary
- 設計書 §3.3 PoC ゲート (Phase 2) を成功裏に通過したことを前提に、`Agent.create` の呼び出しに `local: { cwd: process.cwd() }` を明示
- 該当箇所: `src/openai-proxy.ts`, `src/provider.ts` (型 `AgentCreateOpts` を新設)
- ネイティブモジュール (sqlite3) のワーキングディレクトリ解決をデフォルト挙動に依存させない

## Test plan
- [x] Devcontainer 内で `pnpm test` 全 PASS
- [x] `pnpm typecheck` PASS
- [x] `pnpm lint` PASS
- [x] Phase 2 PoC の判定が「成功」であることを確認 (#<Phase2_PR>)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

### Phase 4 完了処理

- [x] **Step P4.X: Phase Base の Draft PR を `master` に対して作成**

```bash
git checkout feature/phase4_agent-create-finalization__base
git push origin feature/phase4_agent-create-finalization__base
gh pr create --draft \
  --base master \
  --head feature/phase4_agent-create-finalization__base \
  --title "feat(phase4): Pool 容量調整 & Agent.create local mode 明示" \
  --body "$(cat <<'EOF'
## Summary
- Task 4.1 (#<PR>): `POOL_CAPACITY` 8 → 10
- Task 4.2 (#<PR>): `Agent.create({ ..., local: { cwd: process.cwd() } })` を採用 [PoC 失敗時は本 Task をスキップしたうえで PR 本文にその旨を明記]

## Migration summary (設計書 §9 出力フォーマット相当)
1. 移行サマリー: Bun → Node 20+ 完全移行。Devcontainer 統一 / Biome 公開 / dispose 非対称リトライ / pool 容量緩和 / [PoC 成功時のみ] Agent.create local 明示
2. Devcontainer 更新コード: Phase 1 (#<Phase1_PR>)
3. パッケージと設定の更新: Phase 1 Task 1.2 (#<Task1.2_PR>)
4. コアロジックのリファクタリング:
   - `src/openai-proxy.ts` / `src/provider.ts`: 本 Phase Task 4.2
   - `src/agent-cleanup.ts`: Phase 3 (#<Phase3_PR>)
   - `src/index.ts`: 本 Phase Task 4.1
   - `src/agent-pool.ts`: 現状追認（変更なし）
5. Bun API → Node API 置換: ソース側は既に完了済み（設計書 §4.9）

## Test plan
- [x] Devcontainer 内で `pnpm typecheck && pnpm lint && pnpm test` が成功する
- [x] CI ワークフロー (`.github/workflows/ci.yml`, ubuntu-slim) が全 step 成功

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review チェックリスト (実施後の自己確認)

- [x] **Spec coverage**: 設計書 §3.1 変更対象ファイル一覧の各項目に対応する Task がある (Devcontainer = Phase 1 Task 1.1 / package.json = Phase 1 Task 1.2 / src/index.ts = Phase 4 Task 4.1 / src/agent-cleanup.ts = Phase 3 / src/openai-proxy.ts + src/provider.ts = Phase 4 Task 4.2 / AGENTS.md + README.md = Phase 1 Task 1.3 / tests = Phase 3 + Phase 4)
- [x] **PoC ゲート**: 設計書 §3.3 の PoC を Phase 2 として独立 Phase 化し、Phase 4 の実装方針を切り替える条件分岐を明記
- [x] **No placeholders**: 各 Step に具体的なコード片・コマンド・期待出力を記載。「TBD」「適宜」等のプレースホルダなし
- [x] **型整合性**: `AgentCreateOpts` 型は Task 4.2 で 1 箇所に定義し、`provider.ts` 全体で同一名を使用
- [x] **Devcontainer 必須化**: すべてのテスト・型検査・Lint コマンドに「Devcontainer 内で実行」と注記
- [x] **Phase / Task の依存関係**:
  - Phase 1 / 2 / 3 / 4: Phase 単位で逐次（Phase 3 と Phase 4 は PoC 結果に応じて 4 を分岐）
  - Phase 内 Task: 1.1 / 1.2 / 1.3 = 独立 / 2.1 = 単独 / 3.1 → 3.2 (依存) / 4.1 / 4.2 = 独立
- [x] **Draft PR 作成**: 各 Task と各 Phase の完了 Step に Draft PR 作成コマンドを記載
- [x] **master への直接 push / 直接 merge を禁止**: すべての PR は Draft、Task → Phase Base、Phase Base → master の 2 段構成

---

## 補足: 実装エンジニア向け運用メモ

- **Devcontainer 起動忘れチェック**: 単一の判定では環境差で誤判定し得るため、以下の **いずれかが真** であればコンテナ内とみなす（OR 結合）。すべて偽の場合はホスト OS 上で実行している可能性が高いので作業を中断し、Devcontainer に入り直すこと。
  1. `printenv DEVCONTAINER` が `true` を返す（VS Code Dev Containers / Codespaces で自動設定。CLI 起動時は未設定の場合あり）
  2. `test -f /.dockerenv` が exit 0（Docker ベースコンテナで一貫して存在。Devcontainer も該当）
  3. `hostname` がコンテナ ID 風の短いハッシュ文字列を返す（`runArgs --hostname` で上書きされている場合は不正確）

  ワンライナーで確認する例:

  ```bash
  ( [ "$(printenv DEVCONTAINER 2>/dev/null)" = "true" ] || [ -f /.dockerenv ] || hostname | grep -qE '^[0-9a-f]{12}$' ) \
    && echo "inside container" || echo "HOST OS — reopen in container"
  ```
- **PR レビューでのエビデンス**: `pnpm test` / `pnpm typecheck` / `pnpm lint` の実行ログを PR 本文の `<details>` ブロックに貼付する。
- **PoC 失敗時のアフターケア**: Task 4.2 を見送る場合、`tests/integration/` に SDK アップグレード時の回帰検知用の "smoke test" を別 PR で追加する。チケット起票は本 Phase の責務外。
- **既存テストの追加・削除なし**: 本計画は設計書 §2.2 の非ゴール（既存テスト群の拡張は最小限）を厳守し、変更対象のテストのみに手を入れる。
