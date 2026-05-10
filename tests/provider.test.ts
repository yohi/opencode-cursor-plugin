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
    cwd: "/test/cwd",
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
    expect(result?.["composer-2"]).toMatchObject({
      id: "composer-2",
      providerID: "cursor",
      name: "Composer 2",
      api: {
        id: "cursor",
        url: "",
        npm: "",
      },
      limit: {
        context: 200_000,
        output: 16_384,
      },
      capabilities: {
        temperature: true,
        reasoning: true,
        attachment: false,
        toolcall: false,
        input: {
          text: true,
          audio: false,
          image: false,
          video: false,
          pdf: false,
        },
        output: {
          text: true,
          audio: false,
          image: false,
          video: false,
          pdf: false,
        },
        interleaved: false,
      },
    });
  });

  it("list 失敗時に静的フォールバック", async () => {
    const { sdk, hook, ctx } = await makeHookHelper();
    vi.mocked(sdk.Cursor.models.list).mockRejectedValue(new Error("network"));

    const result = await hook.models?.("cursor" as any, ctx);
    expect(result && "composer-2" in result).toBe(true);
  });

  it("apiKey 未解決でも静的フォールバックを返す", async () => {
    const { hook, ctx } = await makeHookHelper(async () => undefined);

    const result = await hook.models?.("cursor" as any, ctx);
    expect(result && "composer-2" in result).toBe(true);
  });

  it("list 10s タイムアウトでフォールバック", async () => {
    vi.useFakeTimers();
    const { sdk, hook, ctx } = await makeHookHelper();
    vi.mocked(sdk.Cursor.models.list).mockImplementation(() => new Promise(() => {}));

    const resultPromise = hook.models?.("cursor" as any, ctx);
    await vi.advanceTimersByTimeAsync(10_000);

    const result = await resultPromise;
    expect(result && "composer-2" in result).toBe(true);
  });

  it("doStream は生成時の ctx を隔離して保持する", async () => {
    const { sdk } = await makeHookHelper();
    vi.mocked(sdk.Cursor.models.list).mockResolvedValue([
      { id: "composer-2", name: "Composer 2", contextWindow: 200_000 } as any,
    ]);
    vi.mocked(sdk.Agent.create).mockResolvedValue({
      send: vi.fn(async (_message: string, opts: any) => {
        opts.onDelta({ update: { type: "turn-ended" } });
        return { wait: async () => ({ status: "finished" }) };
      }),
      close: vi.fn(),
    } as any);

    const ctx1 = { tag: "ctx-1", auth: { get: vi.fn() } } as any;
    const ctx2 = { tag: "ctx-2", auth: { get: vi.fn() } } as any;
    const resolveApiKey = vi.fn(async (ctx: any) => (ctx === ctx1 ? "key-1" : "key-2"));
    const { hook: hookWithSpy } = await makeHookHelper(resolveApiKey);

    const models1 = await hookWithSpy.models?.("cursor" as any, ctx1);
    // 別の ctx で models() が呼ばれても、models1 内の doStream には影響しないはず
    await hookWithSpy.models?.("cursor" as any, ctx2);

    const streamResult = await (models1 as any)?.["composer-2"]?.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
    });

    await streamResult?.stream.getReader().read();

    // models1 から生成された doStream なので ctx1 を使うべき
    expect(resolveApiKey).toHaveBeenCalledWith(ctx1);
    expect(sdk.Agent.create).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "key-1", local: { cwd: "/test/cwd" } }),
    );
  });

  it("listModelsWithTimeout が完了したときに clearTimeout が呼ばれる", async () => {
    const spy = vi.spyOn(global, "clearTimeout");
    try {
      const { sdk, hook, ctx } = await makeHookHelper();
      vi.mocked(sdk.Cursor.models.list).mockResolvedValue([]);

      await hook.models?.("cursor" as any, ctx);

      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
});
