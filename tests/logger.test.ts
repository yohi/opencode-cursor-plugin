import { describe, expect, it, vi } from "vitest";
import { createLogger } from "../.opencode/plugins/cursor-provider/logger";

describe("createLogger", () => {
  it("メソッド形式の rawLog (info/warn/error/debug) に委譲する", () => {
    const rawLog = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    const log = createLogger(rawLog);

    log.info("hello", { foo: 1 });
    expect(rawLog.info).toHaveBeenCalledWith("hello", { foo: 1 });
  });

  it("関数形式の rawLog には body 形式で service=cursor-provider をセットする", () => {
    const rawLog = vi.fn();
    const log = createLogger(rawLog);

    log.warn("oops", { code: 42 });
    expect(rawLog).toHaveBeenCalledWith({
      body: {
        service: "cursor-provider",
        level: "warn",
        message: "oops",
        extra: { code: 42 },
      },
    });
  });

  it("API キー本文・prompt 本文をログに含めない（呼び出し側責務）", () => {
    const rawLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const log = createLogger(rawLog);

    log.info("agent created", { apiKeyFingerprint: "abcd1234", promptLength: 256 });
    const call = rawLog.info.mock.calls[0]?.[1] ?? {};
    expect(JSON.stringify(call)).not.toMatch(/sk-[a-zA-Z0-9_-]{8,}/);
  });
});
