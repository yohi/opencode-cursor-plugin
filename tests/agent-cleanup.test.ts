import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DISPOSE_TIMEOUT_MS, RETRY_DELAY_MS, disposeAgentSafely } from "../src/agent-cleanup.js";
import { createLogger } from "../src/logger.js";

describe("disposeAgentSafely", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("正常系: agent[Symbol.asyncDispose]() を呼び await する", async () => {
    const rawLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const log = createLogger(rawLog);
    const agent = { [Symbol.asyncDispose]: vi.fn().mockResolvedValue(undefined) } as any;

    await disposeAgentSafely(agent, log);

    expect(agent[Symbol.asyncDispose]).toHaveBeenCalledTimes(1);
  });

  it("dispose が 5s 超でハングしてもタイムアウトで戻る (resolves)", async () => {
    const rawLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const log = createLogger(rawLog);
    const agent = { [Symbol.asyncDispose]: vi.fn(() => new Promise<void>(() => {})) } as any;
    const result = disposeAgentSafely(agent, log);

    vi.advanceTimersByTime(5_000);
    await expect(result).resolves.toBeUndefined();
    expect(rawLog.warn).toHaveBeenCalled();
  });

  it("dispose が reject しても rethrow せず warn ログのみ", async () => {
    const rawLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const log = createLogger(rawLog);
    const agent = { [Symbol.asyncDispose]: vi.fn().mockRejectedValue(new TypeError("boom")) } as any;

    await expect(disposeAgentSafely(agent, log)).resolves.toBeUndefined();
    expect(rawLog.warn).toHaveBeenCalled();
    expect(agent[Symbol.asyncDispose]).toHaveBeenCalledTimes(2);
  });

  it("dispose が timeout の場合はリトライしない", async () => {
    const rawLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const log = createLogger(rawLog);
    const agent = { [Symbol.asyncDispose]: vi.fn(() => new Promise<void>(() => {})) } as any;

    const result = disposeAgentSafely(agent, log);
    vi.advanceTimersByTime(DISPOSE_TIMEOUT_MS);
    await expect(result).resolves.toBeUndefined();

    vi.advanceTimersByTime(RETRY_DELAY_MS + 1_000);
    expect(agent[Symbol.asyncDispose]).toHaveBeenCalledTimes(1);
  });
});
