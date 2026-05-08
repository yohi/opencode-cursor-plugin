import { describe, expect, it, vi } from "vitest";
import { ensureCursorProviderConfig } from "../.opencode/plugins/cursor-provider/config";
import CursorProviderPlugin from "../.opencode/plugins/cursor-provider/index";

vi.mock("../.opencode/plugins/cursor-provider/openai-proxy", () => ({
  startOpenAiProxy: vi.fn().mockResolvedValue({
    baseURL: "http://127.0.0.1:32125/v1",
    close: vi.fn().mockResolvedValue(undefined),
  }),
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

  it("プラグインの config hook から cursor provider 定義を追加する", async () => {
    const plugin = await CursorProviderPlugin({
      client: { app: { log: { info() {}, warn() {}, error() {}, debug() {} } } },
    } as any);
    const config: any = {};

    await plugin.config?.(config);

    expect(config.provider.cursor.id).toBe("cursor");
    expect(config.provider.cursor.options.baseURL).toBe("http://127.0.0.1:32125/v1");
  });
});
