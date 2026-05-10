import { afterEach, describe, expect, it, vi } from "vitest";
import { createAgentPool } from "../src/agent-pool.js";
import { createLogger } from "../src/logger.js";
import { createProviderHook } from "../src/provider.js";

vi.mock("@cursor/sdk", async () => ({
  Cursor: {
    models: { list: vi.fn() },
  },
  Agent: { create: vi.fn() },
  AuthenticationError: class extends Error {},
  ConfigurationError: class extends Error {},
  RateLimitError: class extends Error {},
  NetworkError: class extends Error { isRetryable = true; },
  IntegrationNotConnectedError: class extends Error {},
  UnknownAgentError: class extends Error {},
  CursorSdkError: class extends Error {},
}));

const log = createLogger({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() });

async function makeHookHelper(resolveKey: any = async () => "key") {
  const sdk = await import("@cursor/sdk");
  const hook = createProviderHook({
    resolveApiKey: resolveKey,
    log,
    pool: createAgentPool({ log, capacity: 8 }),
  });
  const ctx: any = { auth: { get: async () => undefined } };
  return { sdk, hook, ctx };
}

describe("createProviderHook.models()", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("Cursor.models.list 成功時に SDKModel を ModelV2 化して返す", async () => {
    const { sdk, hook, ctx } = await makeHookHelper();
    vi.mocked(sdk.Cursor.models.list).mockResolvedValue([
      { id: "composer-2", name: "Composer 2", contextWindow: 200_000 } as any,
    ]);

    const result = await hook.models?.("cursor" as any, ctx);
    expect(result && "composer-2" in result).toBe(true);
  });

  it("OpenCode SDK v2 の Model 形状でモデルメタデータを返す", async () => {
    const { sdk, hook, ctx } = await makeHookHelper();
    vi.mocked(sdk.Cursor.models.list).mockResolvedValue([
      { id: "composer-2", name: "Composer 2", contextWindow: 200_000 } as any,
    ]);

    const result = await hook.models?.("cursor" as any, ctx);
    const meta = result?.["composer-2"];
    expect(meta.id).toBe("composer-2");
    expect(meta.name).toBe("Composer 2");
  });

  it("list 失敗時に静的フォールバック", async () => {
    const { sdk, hook, ctx } = await makeHookHelper();
    vi.mocked(sdk.Cursor.models.list).mockRejectedValue(new Error("fail"));

    const result = await hook.models?.("cursor" as any, ctx);
    expect(result && "composer-2" in result).toBe(true);
  });

  it("apiKey 未解決でも静的フォールバックを返す", async () => {
    const { hook, ctx } = await makeHookHelper(async () => undefined);

    const result = await hook.models?.("cursor" as any, ctx);
    expect(result && "composer-2" in result).toBe(true);
  });

  it("list 10s タイムアウトでフォールバック", async () => {
    const { sdk, hook, ctx } = await makeHookHelper();
    vi.mocked(sdk.Cursor.models.list).mockImplementation(() => new Promise(() => {}));

    const originalSetTimeout = global.setTimeout;
    vi.spyOn(global, "setTimeout").mockImplementation((cb: any, ms?: number) => {
      if (ms === 10_000) {
        process.nextTick(cb);
      }
      return 0 as any;
    });

    try {
      const result = await hook.models?.("cursor" as any, ctx);
      expect(result && "composer-2" in result).toBe(true);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("doStream は生成時の ctx を隔離して保持する", async () => {
    const { sdk } = await makeHookHelper();
    vi.mocked(sdk.Cursor.models.list).mockResolvedValue([
      { id: "composer-2", name: "Composer 2", contextWindow: 200_000 } as any,
    ]);

    const resolveApiKey = vi.fn();
    const hook = createProviderHook({
      resolveApiKey,
      log,
      pool: createAgentPool({ log, capacity: 8 }),
    });

    // 1回目の models() 呼び出しで生成された doStream は ctx1 を閉じ込める
    const ctx1 = { id: 1 } as any;
    resolveApiKey.mockResolvedValueOnce("key-1");
    const models1 = await hook.models?.("cursor" as any, ctx1);
    const doStream1 = models1?.["composer-2"].doStream;

    // 2回目の models() 呼び出し (ctx2)
    const ctx2 = { id: 2 } as any;
    resolveApiKey.mockResolvedValueOnce("key-2");
    await hook.models?.("cursor" as any, ctx2);

    // doStream1 を実行。内部で resolveApiKey(ctx1) が呼ばれるはず
    vi.mocked(sdk.Agent.create).mockResolvedValue({
      send: vi.fn().mockResolvedValue({
        wait: async () => ({ status: "finished" }),
      }),
    } as any);

    resolveApiKey.mockResolvedValueOnce("key-1");
    const streamResult = await doStream1({ prompt: [{ role: "user", content: "hi" }] } as any);
    await streamResult?.stream.getReader().read();

    // models1 から生成された doStream なので ctx1 を使うべき
    expect(resolveApiKey).toHaveBeenCalledWith(ctx1);
    expect(sdk.Agent.create).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "key-1", cloud: {} }),
    );
  });

  it("listModelsWithTimeout が完了したときに clearTimeout が呼ばれる", async () => {
    const spy = vi.spyOn(global, "clearTimeout");
    const { sdk, hook, ctx } = await makeHookHelper();
    vi.mocked(sdk.Cursor.models.list).mockResolvedValue([]);

    await hook.models?.("cursor" as any, ctx);

    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
