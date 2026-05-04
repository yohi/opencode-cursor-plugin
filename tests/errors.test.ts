import { describe, expect, it, vi } from "vitest";
import {
  AuthenticationError,
  ConfigurationError,
  RateLimitError,
  NetworkError,
  IntegrationNotConnectedError,
  UnknownAgentError,
  CursorSdkError,
} from "@cursor/sdk";
import { classifyError, logError } from "../.opencode/plugins/cursor-provider/errors";

describe("classifyError", () => {
  it("AuthenticationError は全 phase で retry: false", () => {
    const err = new AuthenticationError("bad key");
    for (const phase of ["create", "pre-stream", "in-stream", "post-stream"] as const) {
      expect(classifyError(err, { phase }).retry).toBe(false);
    }
  });

  it("NetworkError は create / pre-stream で retry:true (delay 500ms)", () => {
    const err = new NetworkError("disconnect");
    Object.assign(err, { isRetryable: true });
    expect(classifyError(err, { phase: "create" })).toMatchObject({ retry: true, delayMs: 500 });
    expect(classifyError(err, { phase: "pre-stream" })).toMatchObject({ retry: true, delayMs: 500 });
  });

  it("NetworkError は in-stream / post-stream では retry: false（ストリーム重複防止）", () => {
    const err = new NetworkError("flap");
    Object.assign(err, { isRetryable: true });
    expect(classifyError(err, { phase: "in-stream" }).retry).toBe(false);
    expect(classifyError(err, { phase: "post-stream" }).retry).toBe(false);
  });

  it("RateLimitError / ConfigurationError / IntegrationNotConnectedError は retry: false", () => {
    expect(classifyError(new RateLimitError("rl"), { phase: "create" }).retry).toBe(false);
    expect(classifyError(new ConfigurationError("cfg"), { phase: "pre-stream" }).retry).toBe(false);
    expect(
      classifyError(
        new IntegrationNotConnectedError("noconn", {
          helpUrl: "https://example.com",
          provider: "github",
        }),
        { phase: "create" },
      ).retry,
    ).toBe(false);
  });

  it("UnknownAgentError は in-stream を含む全 phase で retry: false（呼び出し側で別経路リトライ）", () => {
    expect(classifyError(new UnknownAgentError("gone"), { phase: "in-stream" }).retry).toBe(false);
  });

  it("予期せぬ例外は retry: false", () => {
    expect(classifyError(new Error("boom"), { phase: "create" }).retry).toBe(false);
  });
});

describe("logError", () => {
  it("API キー文字列・prompt 本文をログに出さず、length と type のみ記録", () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

    logError(log, new AuthenticationError("sk-very-secret-12345"), { phase: "create" });

    const args = log.error.mock.calls[0]?.[1] ?? {};
    expect(JSON.stringify(args)).not.toMatch(/sk-very-secret/);
    expect(args.errorType).toBe("AuthenticationError");
  });
});
