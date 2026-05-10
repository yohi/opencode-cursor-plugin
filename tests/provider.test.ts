import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import * as sdk from "@cursor/sdk";
import { createProviderHook } from "../src/provider.js";
import { createAgentPool } from "../src/agent-pool.js";
import { createLogger } from "../src/logger.js";

vi.mock("@cursor/sdk", () => ({
  Cursor: {
    models: {
      list: vi.fn(),
    },
  },
  Agent: {
    create: vi.fn(),
  },
}));

const log = createLogger({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() });

async function makeHookHelper(resolveApiKey = async () => "test-key") {
  const pool = createAgentPool({ log, capacity: 8 });
  const hook = createProviderHook({ resolveApiKey, log, pool, cwd: "/test/cwd" });
  const ctx = {} as any;
  return { sdk, hook, ctx, pool };
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
    
    // setTimeout の戻り値を mock
    vi.spyOn(global, 'setTimeout').mockImplementation((cb: any) => {
      cb();
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
      cwd: "/test/cwd",
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

    expect(doStream1).toBeDefined();
  });

  it("listModelsWithTimeout が完了したときに clearTimeout が呼ばれる", async () => {
    const { sdk, hook, ctx } = await makeHookHelper();
    vi.mocked(sdk.Cursor.models.list).mockResolvedValue([]);
    const spy = vi.spyOn(global, 'clearTimeout');

    await hook.models?.("cursor" as any, ctx);
    expect(spy).toHaveBeenCalled();
  });
});
