# Fix Agent Pool Parallel Checkout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `AgentPool.tryGet` をエクスクルーシブチェックアウト方式（取得時にプールから即時削除）に変更し、同一エージェントの並列使用によるステート破損を防止する。

**Architecture:**
- `AgentPool.tryGet` が成功した場合に `Map` からエントリを削除するように変更。
- `provider.ts` 側の `runDoStream` で、チェックアウトされたエージェントのライフサイクル管理（成功時に `put` で戻す、または失敗時に `dispose` する）を徹底する。
- `recreateAgent` 時に、既にチェックアウト済みのエージェントを明示的に破棄するように修正。

**Tech Stack:** TypeScript, Vitest

---

### Task 1: Update AgentPool for exclusive checkout

**Files:**
- Modify: `.opencode/plugins/cursor-provider/agent-pool.ts`
- Test: `tests/agent-pool.test.ts`

- [ ] **Step 1: Add failing test for exclusive checkout in `tests/agent-pool.test.ts`**

```typescript
  it("tryGet はエントリを取得するとプールから削除する (Exclusive Checkout)", async () => {
    const pool = createAgentPool({ log, capacity: 2 });
    const agent = { [Symbol.asyncDispose]: async () => {} } as any;
    const hash = "abc";
    const modelId = "model";
    const apiKey = "key";

    await pool.put(hash, { agent, lastUsedAt: Date.now(), modelId, apiKeyFingerprint: "fp" });

    const hit1 = pool.tryGet(hash, modelId, apiKey);
    expect(hit1).toBeDefined();
    expect(hit1?.agent).toBe(agent);

    // 2回目は削除されているため取得できないはず
    const hit2 = pool.tryGet(hash, modelId, apiKey);
    expect(hit2).toBeUndefined();
  });
```

- [ ] **Step 2: Run test to verify failure**

Run: `pnpm vitest run tests/agent-pool.test.ts`
Expected: FAIL (hit2 is not undefined)

- [ ] **Step 3: Update `tryGet` implementation in `.opencode/plugins/cursor-provider/agent-pool.ts`**

```typescript
// .opencode/plugins/cursor-provider/agent-pool.ts の tryGet を修正
    tryGet(hash, modelId, apiKey) {
      const key = poolKey(fingerprintApiKey(apiKey), modelId, hash);
      const entry = map.get(key);
      if (!entry) return undefined;

      // Exclusive checkout: 取得したらプールから削除する
      map.delete(key);
      entry.lastUsedAt = Date.now();
      return entry;
    },
```

- [ ] **Step 4: Run test to verify success**

Run: `pnpm vitest run tests/agent-pool.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add .opencode/plugins/cursor-provider/agent-pool.ts tests/agent-pool.test.ts
git commit -m "refactor(cursor-provider): implement exclusive checkout in AgentPool"
```

---

### Task 2: Update Provider to manage checked-out agent lifecycle

**Files:**
- Modify: `.opencode/plugins/cursor-provider/provider.ts`

- [ ] **Step 1: Update `runDoStream` to handle checkin/dispose**

`hit` があった場合、エージェントは既にプールから削除されている（排他的チェックアウト）。
そのため、ストリーム完了時に `pool.put` で戻すか、エラー時に `disposeAgentSafely` で破棄する責任が `runDoStream` に移る。

```typescript
// .opencode/plugins/cursor-provider/provider.ts の runDoStream 内の done.then などを修正

  // ...
  let replacedAgent: any;
  const recreateAgent = hit
    ? async () => {
        // hit がある場合は既にプールから出ているため、delete ではなく直接破棄する
        await disposeAgentSafely(agent, log);
        const fresh = await createAgentWithRetry({ apiKey, modelId, log });
        replacedAgent = fresh;
        return { agent: fresh, message: translated.fullPromptOnMiss };
      }
    : undefined;
  // ...

  void done
    .then(async ({ finishReason, errorType }) => {
      const finalAgent = replacedAgent || agent;
      if (finishReason === "stop") {
        // 成功時は新しいハッシュでプールに戻す
        await pool.put(translated.nextHash, {
          agent: finalAgent,
          lastUsedAt: Date.now(),
          modelId,
          apiKeyFingerprint: fingerprint,
        });
        return;
      }

      // 失敗時や中断時は破棄する
      // すでにプールからは削除されている（hit 時も wasMiss 時も）
      await disposeAgentSafely(finalAgent, log);
      
      if (errorType) {
        log.debug("cursor-provider: stream ended with errorType", { errorType });
      }
    })
    .catch((err) => {
      logError(log, err, { phase: "post-stream" });
    });
```

- [ ] **Step 2: Remove redundant code and update tests if necessary**

`pool.rekey` や `pool.delete` (失敗時) の呼び出しが不要になるため削除・整理する。

- [ ] **Step 3: Run all provider tests**

Run: `pnpm vitest run tests/provider.test.ts`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add .opencode/plugins/cursor-provider/provider.ts
git commit -m "fix(cursor-provider): manage agent lifecycle correctly with exclusive checkout"
```

---

### Task 3: Final Verification

- [ ] **Step 1: Run all tests in the workspace**

Run: `pnpm vitest`
Expected: ALL PASS

- [ ] **Step 2: Final check of the changes**

コードをレビューし、並列呼び出し時に同一エージェントが取得されないこと、およびどのような終了パスでもリソースが漏洩しない（プールに戻るか破棄される）ことを確認する。
