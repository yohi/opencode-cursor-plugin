import type { SDKAgent } from "@cursor/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	type PooledAgent,
	createAgentPool,
	fingerprintApiKey,
} from "../src/agent-pool.js";
import { createLogger } from "../src/logger.js";

const log = createLogger({
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
	debug: vi.fn(),
});

const makeAgent = (apiKey = "key-original"): PooledAgent => ({
	agent: {
		[Symbol.asyncDispose]: vi.fn().mockResolvedValue(undefined),
		close: vi.fn(),
	} as unknown as SDKAgent,
	lastUsedAt: Date.now(),
	modelId: "composer-2",
	apiKeyFingerprint: fingerprintApiKey(apiKey),
});

describe("AgentPool", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("tryGet ヒット時に lastUsedAt が更新される", async () => {
		const pool = createAgentPool({ log, capacity: 8 });
		const apiKey = "key-original";
		const agent = makeAgent(apiKey);

		await pool.put("h1", agent);
		vi.advanceTimersByTime(1_000);

		const hit = pool.tryGet("h1", agent.modelId, apiKey);
		expect(hit).toBeDefined();
		expect(hit?.lastUsedAt).toBe(Date.now());
	});

	it("tryGet はエントリを取得するとプールから削除する (Exclusive Checkout)", async () => {
		const pool = createAgentPool({ log, capacity: 2 });
		const apiKey = "key";
		const agent = makeAgent(apiKey);
		const hash = "abc";

		await pool.put(hash, agent);

		const hit1 = pool.tryGet(hash, agent.modelId, apiKey);
		expect(hit1).toBeDefined();
		expect(hit1?.agent).toBe(agent.agent);

		// 2回目は削除されているため取得できないはず
		const hit2 = pool.tryGet(hash, agent.modelId, apiKey);
		expect(hit2).toBeUndefined();
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
		const pool = createAgentPool({ log, capacity: 8 });
		const apiKey = "k";
		const a = makeAgent(apiKey);
		const b = makeAgent(apiKey);

		await pool.put("h1", a);
		await pool.put("h1", b);

		expect(a.agent[Symbol.asyncDispose]).toHaveBeenCalledTimes(1);
		expect(b.agent[Symbol.asyncDispose]).not.toHaveBeenCalled();
		expect(pool.tryGet("h1", a.modelId, apiKey)?.agent).toBe(b.agent);
	});

	it("同一複合キーへの再 put で同一 agent インスタンスは dispose しない（自己 dispose 防止）", async () => {
		const pool = createAgentPool({ log, capacity: 8 });
		const apiKey = "k";
		const a = makeAgent(apiKey);

		await pool.put("h1", a);
		await pool.put("h1", a);

		expect(a.agent[Symbol.asyncDispose]).not.toHaveBeenCalled();
	});

	it("agent[Symbol.asyncDispose] が 5s でタイムアウトしても put は完了する", async () => {
		const pool = createAgentPool({ log, capacity: 1 });
		const stuck = makeAgent();
		stuck.agent[Symbol.asyncDispose] = vi.fn(() => new Promise<void>(() => {}));

		await pool.put("h1", stuck);
		const result = pool.put("h2", makeAgent());

		vi.advanceTimersByTime(5_000);
		await expect(result).resolves.toBeUndefined();
	});

	it("apiKey が異なれば別エントリとして扱う", async () => {
		const pool = createAgentPool({ log, capacity: 8 });
		const apiKeyA = "key-a";
		const apiKeyB = "key-b";
		const a = makeAgent(apiKeyA);
		const b = makeAgent(apiKeyB);

		await pool.put("h1", a);
		await pool.put("h1", b);

		expect(pool.tryGet("h1", a.modelId, apiKeyA)?.apiKeyFingerprint).toBe(
			a.apiKeyFingerprint,
		);
		expect(pool.tryGet("h1", b.modelId, apiKeyB)?.apiKeyFingerprint).toBe(
			b.apiKeyFingerprint,
		);
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
