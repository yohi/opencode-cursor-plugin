import { describe, expect, it, vi } from "vitest";
import { ensureCursorProviderConfig } from "../src/config.js";
import CursorProviderPlugin from "../src/index.js";

vi.mock("../src/openai-proxy.js", () => ({
  startOpenAiProxy: vi.fn().mockResolvedValue({
    baseURL: "http://127.0.0.1:32125/v1",
    close: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("@cursor/sdk", () => ({
  Cursor: {
    models: {
      list: vi.fn().mockResolvedValue([]),
    },
  },
}));

describe("ensureCursorProviderConfig", () => {
  it("provider.cursor が無い設定に cursor provider 定義を追加する", () => {
    const config: any = {};

    ensureCursorProviderConfig(config);

    expect(config.provider.cursor).toMatchObject({
      id: "cursor",
      name: "Cursor",
      npm: "@ai-sdk/openai-compatible",
      options: { baseURL: "http://127.0.0.1:32125/v1" },
    });
    expect(config.provider.cursor.models["composer-2"].name).toBe("Composer 2 (initializing...)");
  });

  it("既存の cursor provider 設定を上書きしない", () => {
    const config: any = {
      provider: {
        cursor: {
          name: "Custom Cursor",
          options: { timeout: 1000 },
          models: { custom: { name: "Custom" } },
        },
      },
    };

    ensureCursorProviderConfig(config);

    expect(config.provider.cursor).toMatchObject({
      id: "cursor",
      name: "Custom Cursor",
      npm: "@ai-sdk/openai-compatible",
      options: { timeout: 1000 },
      models: { custom: { name: "Custom" } },
    });
    expect(config.provider.cursor.models["composer-2"].name).toBe("Composer 2 (initializing...)");
  });

  it("enabled_providers がある場合に cursor を自動追加する", () => {
    const config: any = {
      enabled_providers: ["openai", "google"],
    };

    ensureCursorProviderConfig(config);

    expect(config.enabled_providers).toContain("cursor");
    expect(config.enabled_providers).toEqual(expect.arrayContaining(["openai", "google"]));
    expect(config.enabled_providers).toHaveLength(3);
  });

  it("enabled_providers にすでに cursor がある場合は重複追加しない", () => {
    const config: any = {
      enabled_providers: ["cursor", "openai"],
    };

    ensureCursorProviderConfig(config);

    expect(config.enabled_providers).toEqual(["cursor", "openai"]);
    expect(config.enabled_providers).toHaveLength(2);
  });

  it("プラグインの config hook から cursor provider 定義を追加する", async () => {
    const plugin = await CursorProviderPlugin({
      client: { 
        app: { log: { info() {}, warn() {}, error() {}, debug() {} } },
        auth: { get: vi.fn().mockResolvedValue(undefined) }
      },
    } as any);
    const config: any = {};

    await plugin.config?.(config);

    expect(config.provider.cursor.id).toBe("cursor");
    expect(config.provider.cursor.options.baseURL).toBe("http://127.0.0.1:32125/v1");
  });
});

describe("CursorProviderPlugin auth resolution", () => {
  it("auth.authenticate が成功した場合に認証情報を取得できる", async () => {
    const authenticate = vi.fn().mockResolvedValue({ type: "api", key: "test-key" });
    const plugin = await CursorProviderPlugin({
      client: { 
        app: { log: { info() {}, warn() {}, error() {}, debug() {} } },
        auth: { authenticate }
      },
    } as any);
    
    // provider.models() は内部で resolveApiKey を呼び出す
    await plugin.provider?.models?.({} as any, { auth: { authenticate } } as any);
    
    expect(authenticate).toHaveBeenCalledWith({ id: "cursor" });
  });

  it("auth.authenticate がタイムアウトした場合に警告ログを出力しフォールバックする", async () => {
    vi.useFakeTimers();
    try {
      const warn = vi.fn();
      const authenticate = vi.fn().mockReturnValue(new Promise(() => {})); // 解決しない
      const plugin = await CursorProviderPlugin({
        client: { 
          app: { log: { info() {}, warn, error() {}, debug() {} } },
          auth: { authenticate }
        },
      } as any);
      
      const modelsPromise = plugin.provider?.models?.({} as any, { auth: { authenticate } } as any);
      
      // タイムアウト（2000ms）を待機
      await vi.advanceTimersByTimeAsync(2100);
      await modelsPromise;
      
      expect(authenticate).toHaveBeenCalledWith({ id: "cursor" });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("auth.authenticate failed or timed out"), expect.anything());
    } finally {
      vi.useRealTimers();
    }
  });
});
