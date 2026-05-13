import * as timers from "node:timers/promises";
import type { SDKAgent } from "@cursor/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	DISPOSE_TIMEOUT_MS,
	RETRY_DELAY_MS,
	disposeAgentSafely,
} from "../src/agent-cleanup.js";
import { createLogger } from "../src/logger.js";

type DisposableAgent = Pick<SDKAgent, typeof Symbol.asyncDispose>;

vi.mock("node:timers/promises", () => ({
	setTimeout: vi.fn().mockResolvedValue(undefined),
}));

describe("disposeAgentSafely", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.clearAllMocks();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("正常系: agent[Symbol.asyncDispose]() を呼び await する", async () => {
		const rawLog = {
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			debug: vi.fn(),
		};
		const log = createLogger(rawLog);
		const agent: DisposableAgent = {
			[Symbol.asyncDispose]: vi.fn().mockResolvedValue(undefined),
		};

		await disposeAgentSafely(agent as SDKAgent, log);

		expect(agent[Symbol.asyncDispose]).toHaveBeenCalledTimes(1);
	});

	it("dispose が 5s 超でハングしてもタイムアウトで戻る (resolves)", async () => {
		const rawLog = {
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			debug: vi.fn(),
		};
		const log = createLogger(rawLog);
		const agent: DisposableAgent = {
			[Symbol.asyncDispose]: vi.fn(() => new Promise<void>(() => {})),
		};
		const result = disposeAgentSafely(agent as SDKAgent, log);

		await vi.advanceTimersByTimeAsync(5_000);
		await expect(result).resolves.toBeUndefined();
		expect(rawLog.warn).toHaveBeenCalled();
	});

	it("dispose が reject しても rethrow せず warn ログのみ", async () => {
		const rawLog = {
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			debug: vi.fn(),
		};
		const log = createLogger(rawLog);
		const agent: DisposableAgent = {
			[Symbol.asyncDispose]: vi.fn().mockRejectedValue(new TypeError("boom")),
		};

		await expect(
			disposeAgentSafely(agent as SDKAgent, log),
		).resolves.toBeUndefined();
		expect(rawLog.warn).toHaveBeenCalledWith(
			"cursor-provider: agent dispose failed",
			expect.objectContaining({ errorType: "TypeError" }),
		);
		expect(agent[Symbol.asyncDispose]).toHaveBeenCalledTimes(2);
		expect(timers.setTimeout).toHaveBeenCalledWith(RETRY_DELAY_MS);
	});

	it("dispose が timeout の場合はリトライしない", async () => {
		const rawLog = {
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			debug: vi.fn(),
		};
		const log = createLogger(rawLog);
		const agent: DisposableAgent = {
			[Symbol.asyncDispose]: vi.fn(() => new Promise<void>(() => {})),
		};

		const result = disposeAgentSafely(agent as SDKAgent, log);
		await vi.advanceTimersByTimeAsync(DISPOSE_TIMEOUT_MS);
		await expect(result).resolves.toBeUndefined();

		await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS + 1_000);
		expect(agent[Symbol.asyncDispose]).toHaveBeenCalledTimes(1);
	});
});
