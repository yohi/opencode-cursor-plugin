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
import { classifyError, logError } from "../src/errors.js";

// Ensure mock classes have the correct 'name' property even if minified/transpiled
vi.mock("@cursor/sdk", () => {
  const createMockError = (name: string) => {
    return class extends Error {
      constructor(m: string) {
        super(m);
        this.name = name;
      }
    };
  };

  return {
    AuthenticationError: createMockError("AuthenticationError"),
    ConfigurationError: createMockError("ConfigurationError"),
    RateLimitError: createMockError("RateLimitError"),
    NetworkError: createMockError("NetworkError"),
    IntegrationNotConnectedError: createMockError("IntegrationNotConnectedError"),
    UnknownAgentError: createMockError("UnknownAgentError"),
    CursorSdkError: createMockError("CursorSdkError"),
  };
});

describe("classifyError", () => {
  it("AuthenticationError は全 phase で retry: false", () => {
    const err = new AuthenticationError("bad key");
    for (const phase of ["create", "pre-stream", "in-stream", "post-stream"] as const) {
      expect(classifyError(err, { phase }).retry).toBe(false);
    }
  });

  it("NetworkError は create / pre-stream で retry:true (delay 1000ms)", () => {
    const err = new NetworkError("disconnect");
    expect(classifyError(err, { phase: "create" })).toMatchObject({ retry: true, delayMs: 1000 });
    expect(classifyError(err, { phase: "pre-stream" })).toMatchObject({ retry: true, delayMs: 1000 });
  });

  it("ConnectError / Unavailable / DeadlineExceeded もネットワークエラーとして retry: true", () => {
    for (const name of ["ConnectError", "Unavailable", "DeadlineExceeded"]) {
      const err = new Error("grpc fail");
      err.name = name;
      expect(classifyError(err, { phase: "create" })).toMatchObject({ retry: true, delayMs: 1000 });
    }
  });

  it("メッセージに 'network error' や 'timeout' が含まれる場合も retry: true", () => {
    expect(classifyError(new Error("A network error occurred"), { phase: "create" })).toMatchObject({ retry: true, delayMs: 1000 });
    expect(classifyError(new Error("request timed out"), { phase: "create" })).toMatchObject({ retry: true, delayMs: 1000 });
  });

  it("RateLimitError は create / pre-stream で retry: true (delay 2000ms)", () => {
    expect(classifyError(new RateLimitError("rl"), { phase: "create" })).toMatchObject({
      retry: true,
      delayMs: 2000,
    });
  });

  it("ResourceExhausted やメッセージに 'rate limit' が含まれる場合もレート制限として retry: true", () => {
    const err = new Error("out of quota");
    err.name = "ResourceExhausted";
    expect(classifyError(err, { phase: "create" })).toMatchObject({ retry: true, delayMs: 2000 });
    expect(classifyError(new Error("Rate limit exceeded"), { phase: "create" })).toMatchObject({ retry: true, delayMs: 2000 });
  });

  it("RateLimitError は in-stream / post-stream で retry: false (ストリーム重複防止)", () => {
    expect(classifyError(new RateLimitError("rl"), { phase: "in-stream" }).retry).toBe(false);
    expect(classifyError(new RateLimitError("rl"), { phase: "post-stream" }).retry).toBe(false);
  });

  it("ConfigurationError / IntegrationNotConnectedError / CursorSdkError は retry: false", () => {
    expect(classifyError(new ConfigurationError("cfg"), { phase: "pre-stream" }).retry).toBe(false);
    expect(
      classifyError(
        new IntegrationNotConnectedError("noconn", {
          helpUrl: "https://example.com",
          provider: "github",
        } as any),
        { phase: "create" },
      ).retry,
    ).toBe(false);
    expect(classifyError(new CursorSdkError("sdk error"), { phase: "create" }).retry).toBe(false);
  });

  it("CursorSdkError のサブクラスも CursorSdkError として識別される (Issue 2)", () => {
    class SubSdkError extends CursorSdkError {
      constructor(m: string) {
        super(m);
        this.name = "SubSdkError";
      }
    }
    const err = new SubSdkError("test");
    expect(classifyError(err, { phase: "create" }).reason).toBe("CursorSdkError");
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
