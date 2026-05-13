import * as sdk from "@cursor/sdk";
import type { ProviderHookContext } from "@opencode-ai/plugin";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentPool } from "../src/agent-pool.js";
import { createLogger } from "../src/logger.js";
import { createProviderHook } from "../src/provider.js";

vi.mock("@cursor/sdk", () => ({
	Cursor: {
		models: {
			list: vi.fn(),
		},
	},
	Agent: {
		create: vi.fn(),
	},
	AuthenticationError: class extends Error {},
	ConfigurationError: class extends Error {},
	RateLimitError: class extends Error {},
	NetworkError: class extends Error {
		isRetryable = true;
	},
	IntegrationNotConnectedError: class extends Error {},
	UnknownAgentError: class extends Error {},
	CursorSdkError: class extends Error {},
}));

const log = createLogger({
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
	debug: vi.fn(),
});

async function makeHookHelper(
	resolveApiKey: () => Promise<string | undefined> = async () => "test-key",
) {
	const pool = createAgentPool({ log, capacity: 8 });
	const hook = createProviderHook({ resolveApiKey, log, pool });
	const ctx = {} as ProviderHookContext;
	return { sdk, hook, ctx, pool };
}

function toModelsFn(hook: ReturnType<typeof createProviderHook>) {
	return hook.models as unknown as (
		provider: unknown,
		ctx: ProviderHookContext,
	) => Promise<Record<string, unknown>>;
}

describe("createProviderHook.models()", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("Cursor.models.list 成功時に SDKModel を ModelV2 化して返す", async () => {
		const { sdk, hook, ctx } = await makeHookHelper();
		const modelsFn = toModelsFn(hook);
		const listedModels = [
			{ id: "composer-2", name: "Composer 2", contextWindow: 200_000 },
		] as unknown as Awaited<ReturnType<typeof sdk.Cursor.models.list>>;
		vi.mocked(sdk.Cursor.models.list).mockResolvedValue(listedModels);

		const result = await modelsFn("cursor", ctx);
		expect(result && "composer-2" in result).toBe(true);
	});

	it("OpenCode SDK v2 の Model 形状でモデルメタデータを返す", async () => {
		const { sdk, hook, ctx } = await makeHookHelper();
		const modelsFn = toModelsFn(hook);
		const listedModels = [
			{ id: "composer-2", name: "Composer 2", contextWindow: 200_000 },
		] as unknown as Awaited<ReturnType<typeof sdk.Cursor.models.list>>;
		vi.mocked(sdk.Cursor.models.list).mockResolvedValue(listedModels);

		const result = await modelsFn("cursor", ctx);
		const meta = result?.["composer-2"];
		expect(meta).toBeDefined();
		if (!meta) return;
		expect(meta.id).toBe("composer-2");
		expect(meta.name).toBe("Composer 2");
	});

	it("list 失敗時に静的フォールバック", async () => {
		const { sdk, hook, ctx } = await makeHookHelper();
		const modelsFn = toModelsFn(hook);
		vi.mocked(sdk.Cursor.models.list).mockRejectedValue(new Error("fail"));

		const result = await modelsFn("cursor", ctx);
		expect(result && "composer-2" in result).toBe(true);
	});

	it("apiKey 未解決でも静的フォールバックを返す", async () => {
		const { hook, ctx } = await makeHookHelper(async () => undefined);
		const modelsFn = toModelsFn(hook);

		const result = await modelsFn("cursor", ctx);
		expect(result && "composer-2" in result).toBe(true);
	});

	it("list 10s タイムアウトでフォールバック", async () => {
		const { sdk, hook, ctx } = await makeHookHelper();
		const modelsFn = toModelsFn(hook);
		vi.mocked(sdk.Cursor.models.list).mockImplementation(
			() => new Promise(() => {}),
		);

		// setTimeout の戻り値を mock
		vi.spyOn(global, "setTimeout").mockImplementation((cb: TimerHandler) => {
			if (typeof cb === "function") cb();
			return 0 as unknown as ReturnType<typeof global.setTimeout>;
		});

		try {
			const result = await modelsFn("cursor", ctx);
			expect(result && "composer-2" in result).toBe(true);
		} finally {
			vi.restoreAllMocks();
		}
	});

	it("doStream は生成時の ctx を隔離して保持する", async () => {
		const { sdk } = await makeHookHelper();
		const listedModels = [
			{ id: "composer-2", name: "Composer 2", contextWindow: 200_000 },
		] as unknown as Awaited<ReturnType<typeof sdk.Cursor.models.list>>;
		vi.mocked(sdk.Cursor.models.list).mockResolvedValue(listedModels);

		const resolveApiKey = vi.fn();
		const hook = createProviderHook({
			resolveApiKey,
			log,
			pool: createAgentPool({ log, capacity: 8 }),
		});
		const modelsFn = toModelsFn(hook);

		// 1回目の models() 呼び出しで生成された doStream は ctx1 を閉じ込める
		const ctx1 = { id: 1 } as unknown as ProviderHookContext;
		resolveApiKey.mockResolvedValueOnce("key-1");
		const models1 = await modelsFn("cursor", ctx1);
		const doStream1 = (
			models1?.["composer-2"] as
				| {
						doStream: (args: { prompt: unknown[] }) => Promise<{
							stream: ReadableStream;
						}>;
				  }
				| undefined
		)?.doStream;

		// 2回目の models() 呼び出し (ctx2)
		const ctx2 = { id: 2 } as unknown as ProviderHookContext;
		resolveApiKey.mockResolvedValueOnce("key-2");
		const models2 = await modelsFn("cursor", ctx2);
		const doStream2 = (
			models2?.["composer-2"] as
				| {
						doStream: (args: { prompt: unknown[] }) => Promise<{
							stream: ReadableStream;
						}>;
				  }
				| undefined
		)?.doStream;

		expect(doStream1).not.toBe(doStream2);
		expect(doStream1).toBeDefined();
		if (!doStream1) return;

		// doStream1 を実行。内部で resolveApiKey(ctx1) が呼ばれるはず
		vi.mocked(sdk.Agent.create).mockResolvedValue({
			send: vi.fn().mockResolvedValue({
				wait: async () => ({ status: "finished" }),
			}),
			[Symbol.asyncDispose]: vi.fn().mockResolvedValue(undefined),
		} as unknown as Awaited<ReturnType<typeof sdk.Agent.create>>);

		resolveApiKey.mockResolvedValueOnce("key-1");
		const streamResult = await doStream1({
			prompt: [{ role: "user", content: "hi" }],
		} as Parameters<NonNullable<typeof doStream1>>[0]);
		await streamResult?.stream.getReader().read();

		// models1 から生成された doStream なので ctx1 を使うべき
		expect(resolveApiKey).toHaveBeenCalledWith(ctx1, expect.anything());
		expect(sdk.Agent.create).toHaveBeenCalledWith(
			expect.objectContaining({
				apiKey: "key-1",
				local: { cwd: process.cwd() },
			}),
		);
	});

	it("listModelsWithTimeout が完了したときに clearTimeout が呼ばれる", async () => {
		const { sdk, hook, ctx } = await makeHookHelper();
		const modelsFn = toModelsFn(hook);
		vi.mocked(sdk.Cursor.models.list).mockResolvedValue([]);
		const spy = vi.spyOn(global, "clearTimeout");

		await modelsFn("cursor", ctx);
		expect(spy).toHaveBeenCalled();
	});
});
