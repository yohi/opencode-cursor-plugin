import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cursorAuthHook, resolveApiKey } from "../.opencode/plugins/cursor-provider/auth.js";

describe("resolveApiKey", () => {
  const original = process.env.CURSOR_API_KEY;

  beforeEach(() => {
    delete process.env.CURSOR_API_KEY;
  });

  afterEach(() => {
    if (original !== undefined) process.env.CURSOR_API_KEY = original;
    else delete process.env.CURSOR_API_KEY;
  });

  it("ctx.auth に api キーがあれば最優先で返す", async () => {
    process.env.CURSOR_API_KEY = "from-env";
    const ctx: any = { auth: { get: async () => ({ type: "api", key: "from-ctx" }) } };

    expect(await resolveApiKey(ctx)).toBe("from-ctx");
  });

  it("ctx.auth が無ければ env をフォールバック", async () => {
    process.env.CURSOR_API_KEY = "from-env";
    const ctx: any = { auth: { get: async () => undefined } };

    expect(await resolveApiKey(ctx)).toBe("from-env");
  });

  it("両方欠落で undefined", async () => {
    const ctx: any = { auth: { get: async () => undefined } };
    expect(await resolveApiKey(ctx)).toBeUndefined();
  });

  it("空白のみのキーは undefined 扱い", async () => {
    const ctx: any = { auth: { get: async () => ({ type: "api", key: "   " }) } };
    expect(await resolveApiKey(ctx)).toBeUndefined();
  });
});

describe("cursorAuthHook", () => {
  it("methods に api タイプを含み、prompts は key 1 件", () => {
    expect(cursorAuthHook.methods.some((method) => method.type === "api")).toBe(true);

    const apiMethod = cursorAuthHook.methods.find((method) => method.type === "api");
    expect(apiMethod?.prompts).toHaveLength(1);
    expect(apiMethod?.prompts?.[0]).toMatchObject({ key: "key", type: "text" });
  });
});
