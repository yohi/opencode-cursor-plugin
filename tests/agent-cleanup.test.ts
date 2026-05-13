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

    vi.advanceTimersByTime(DISPOSE_TIMEOUT_MS);
    await expect(result).resolves.toBeUndefined();
    expect(rawLog.warn).toHaveBeenCalledWith(
      expect.stringContaining("agent dispose timed out; not retrying"),
      expect.objectContaining({ timeoutMs: DISPOSE_TIMEOUT_MS }),
    );
  });

  it("dispose が reject しても rethrow せず warn ログのみ", async () => {
    const rawLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const log = createLogger(rawLog);
    const agent = { [Symbol.asyncDispose]: vi.fn().mockRejectedValue(new TypeError("boom")) } as any;

    const result = disposeAgentSafely(agent, log);
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);
    await expect(result).resolves.toBeUndefined();
    expect(rawLog.warn).toHaveBeenCalledWith(
      expect.stringContaining("agent dispose failed; retrying once"),
      expect.objectContaining({ errorType: "TypeError" })
    );
    expect(agent[Symbol.asyncDispose]).toHaveBeenCalledTimes(2);
  });

  it("タイムアウト経路: 1 回目で resolve せずリトライもしない (Symbol.asyncDispose 呼び出しは 1 回のみ)", async () => {
    const rawLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const log = createLogger(rawLog);
    const disposeFn = vi.fn(() => new Promise<void>(() => {})); // 永久 pending
    const agent = { [Symbol.asyncDispose]: disposeFn } as any;

    const result = disposeAgentSafely(agent, log);

    vi.advanceTimersByTime(DISPOSE_TIMEOUT_MS); // DISPOSE_TIMEOUT_MS
    await expect(result).resolves.toBeUndefined();

    expect(disposeFn).toHaveBeenCalledTimes(1);
    expect(rawLog.warn).toHaveBeenCalledWith(
      expect.stringContaining("agent dispose timed out; not retrying"),
      expect.objectContaining({ timeoutMs: DISPOSE_TIMEOUT_MS }),
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

    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS); // RETRY_DELAY_MS
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

    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);
    await expect(result).resolves.toBeUndefined();

    expect(disposeFn).toHaveBeenCalledTimes(2);
    expect(rawLog.warn).toHaveBeenCalledWith(
      expect.stringContaining("agent dispose retry failed"),
      expect.objectContaining({ errorType: "TypeError" }),
    );
  });

  it("retryResult === 'timeout' 経路: 1 回目 reject → リトライがタイムアウトした場合", async () => {
    const rawLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const log = createLogger(rawLog);
    const disposeFn = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("boom"))
      .mockImplementationOnce(() => new Promise(() => {})); // リトライ時にハング
    const agent = { [Symbol.asyncDispose]: disposeFn } as any;

    const result = disposeAgentSafely(agent, log);

    // 1回目の失敗後のリトライ待機を消化
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);
    // リトライ時のタイムアウトを消化
    vi.advanceTimersByTime(DISPOSE_TIMEOUT_MS);

    await expect(result).resolves.toBeUndefined();

    expect(disposeFn).toHaveBeenCalledTimes(2);
    // 最初の失敗ログ
    expect(rawLog.warn).toHaveBeenCalledWith(
      expect.stringContaining("agent dispose failed; retrying once"),
      expect.objectContaining({ errorType: "TypeError" }),
    );
    // リトライタイムアウトログ
    expect(rawLog.warn).toHaveBeenCalledWith(
      expect.stringContaining("agent dispose retry timed out"),
      expect.objectContaining({ timeoutMs: DISPOSE_TIMEOUT_MS }),
    );
  });
});
