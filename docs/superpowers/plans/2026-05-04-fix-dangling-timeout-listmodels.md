# Fix dangling timeout in listModelsWithTimeout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `listModelsWithTimeout` 関数において、タイムアウト用のタイマーが適切にクリアされるように修正し、リソースリークを防ぐ。

**Architecture:** `Promise.race` で使用している `setTimeout` の ID を保持し、`finally` ブロックで `clearTimeout` を呼び出す。

**Tech Stack:** TypeScript, Vitest

---

### Task 1: Write failing test

**Files:**
- Modify: `tests/provider.test.ts`

- [ ] **Step 1: Add failing test case to verify `clearTimeout` is called**

```typescript
  it("listModelsWithTimeout が完了したときに clearTimeout が呼ばれる", async () => {
    const spy = vi.spyOn(global, 'clearTimeout');
    const sdk = await import("@cursor/sdk");
    vi.mocked(sdk.Cursor.models.list).mockResolvedValue([]);

    const hook = createProviderHook({
      resolveApiKey: async () => "key",
      log,
      pool: createAgentPool({ log, capacity: 8 }),
    });

    const ctx: any = { auth: { get: async () => undefined } };
    await hook.models?.("cursor" as any, ctx);

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/provider.test.ts`
Expected: FAIL (or PASS if vitest's mock timers or other tests interfere, but logically it should not be called in the current implementation)

### Task 2: Implement the fix

**Files:**
- Modify: `.opencode/plugins/cursor-provider/provider.ts`

- [ ] **Step 1: Update `listModelsWithTimeout` to clear timeout**

```typescript
async function listModelsWithTimeout(apiKey: string, log: Logger) {
  let timeoutId: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      Cursor.models.list({ apiKey }),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error("models.list timeout")), MODELS_LIST_TIMEOUT_MS);
      }),
    ]);
  } catch (err) {
    log.warn("cursor-provider: models.list failed; using static fallback", {
      errorType: err instanceof Error ? err.constructor.name : typeof err,
    });
    return null;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
```

### Task 3: Verify and Commit

- [ ] **Step 1: Run tests to verify they pass**

Run: `pnpm vitest run tests/provider.test.ts`
Expected: ALL PASS

- [ ] **Step 2: Commit changes**

```bash
git add .opencode/plugins/cursor-provider/provider.ts tests/provider.test.ts
git commit -m "fix(cursor-provider): clear dangling timeout in listModelsWithTimeout"
```
