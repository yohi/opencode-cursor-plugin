import { afterEach, describe, expect, it, vi } from "vitest";
import { createAgentPool } from "../.opencode/plugins/cursor-provider/agent-pool";
import { createLogger } from "../.opencode/plugins/cursor-provider/logger";
import { createProviderHook } from "../.opencode/plugins/cursor-provider/provider";

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

describe("createProviderHook.models()", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("Cursor.models.list 成功時に SDKModel を ModelV2 化して返す", async () => {
    const sdk = await import("@cursor/sdk");
    vi.mocked(sdk.Cursor.models.list).mockResolvedValue([
      { id: "composer-2", name: "Composer 2", contextWindow: 200_000 } as any,
    ]);

    const hook = createProviderHook({
      resolveApiKey: async () => "key",
      log,
      pool: createAgentPool({ log, capacity: 8 }),
    });

    const ctx: any = { auth: { get: async () => undefined } };
    const result = await hook.models?.("cursor" as any, ctx);
    expect(result && "composer-2" in result).toBe(true);
  });

  it("list 失敗時に静的フォールバック", async () => {
    const sdk = await import("@cursor/sdk");
    vi.mocked(sdk.Cursor.models.list).mockRejectedValue(new Error("network"));

    const hook = createProviderHook({
      resolveApiKey: async () => "key",
      log,
      pool: createAgentPool({ log, capacity: 8 }),
    });

    const ctx: any = { auth: { get: async () => undefined } };
    const result = await hook.models?.("cursor" as any, ctx);
    expect(result && "composer-2" in result).toBe(true);
  });

  it("apiKey 未解決でも静的フォールバックを返す", async () => {
    const hook = createProviderHook({
      resolveApiKey: async () => undefined,
      log,
      pool: createAgentPool({ log, capacity: 8 }),
    });

    const ctx: any = { auth: { get: async () => undefined } };
    const result = await hook.models?.("cursor" as any, ctx);
    expect(result && "composer-2" in result).toBe(true);
  });

  it("list 5s タイムアウトでフォールバック", async () => {
    vi.useFakeTimers();
    const sdk = await import("@cursor/sdk");
    vi.mocked(sdk.Cursor.models.list).mockImplementation(() => new Promise(() => {}));

    const hook = createProviderHook({
      resolveApiKey: async () => "key",
      log,
      pool: createAgentPool({ log, capacity: 8 }),
    });

    const ctx: any = { auth: { get: async () => undefined } };
    const resultPromise = hook.models?.("cursor" as any, ctx);
    await vi.advanceTimersByTimeAsync(5_000);

    const result = await resultPromise;
    expect(result && "composer-2" in result).toBe(true);
  });
});
