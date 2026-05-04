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
    // Object.assign(err, { isRetryable: true }); // Assume true by default now
    expect(classifyError(err, { phase: "create" })).toMatchObject({ retry: true, delayMs: 500 });
    expect(classifyError(err, { phase: "pre-stream" })).toMatchObject({ retry: true, delayMs: 500 });
  });

  it("NetworkError は in-stream 以降で isRetryable: false (デフォルト) なら retry: false", () => {
    const err = new NetworkError("fatal");
    // Default isRetryable is false in SDK
    expect(classifyError(err, { phase: "in-stream" }).retry).toBe(false);
  });

  it("NetworkError は in-stream 以降では explicitly isRetryable: true でも retry: false（ストリーム重複防止）", () => {
    const err = new NetworkError("retryable-late");
    Object.assign(err, { isRetryable: true });
    expect(classifyError(err, { phase: "in-stream" }).retry).toBe(false);
  });

  it("NetworkError は in-stream / post-stream では retry: false（ストリーム重複防止）", () => {
    const err = new NetworkError("flap");
    expect(classifyError(err, { phase: "in-stream" }).retry).toBe(false);
    expect(classifyError(err, { phase: "post-stream" }).retry).toBe(false);
  });

  it("RateLimitError は retry: true (delay 2000ms)", () => {
    expect(classifyError(new RateLimitError("rl"), { phase: "create" })).toMatchObject({
      retry: true,
      delayMs: 2000,
    });
  });

  it("ConfigurationError / IntegrationNotConnectedError / CursorSdkError は retry: false", () => {
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
    expect(classifyError(new CursorSdkError("sdk error"), { phase: "create" }).retry).toBe(false);
  });

  it("UnknownAgentError は全 phase で retry: false", () => {
    const err = new UnknownAgentError("gone");
    for (const phase of ["create", "pre-stream", "in-stream", "post-stream"] as const) {
      expect(classifyError(err, { phase }).retry).toBe(false);
    }
  });



  it("予期せぬ例外は retry: false", () => {
    expect(classifyError(new Error("boom"), { phase: "create" }).retry).toBe(false);
  });
});

describe("logError", () => {
  it("API キー文字列・prompt 本文をログに出さず、Allowlist にないキーも削除される", () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

    logError(
      log,
      new AuthenticationError("sk-very-secret-12345"),
      { phase: "create", secretKey: "hidden", model: "claude-3", prompt: "some-secret-prompt" }
    );

    const args = log.error.mock.calls[0]?.[1] ?? {};
    const stringified = JSON.stringify(args);
    expect(stringified).not.toMatch(/sk-very-secret/);
    expect(stringified).not.toMatch(/some-secret-prompt/);
    expect(args.phase).toBe("create");
    expect(args.model).toBe("claude-3");
    expect(args.secretKey).toBeUndefined();
    expect(args.errorType).toBe("AuthenticationError");
  });

});
