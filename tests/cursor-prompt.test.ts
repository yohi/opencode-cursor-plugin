import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginInput, Hooks } from "@opencode-ai/plugin";

vi.mock("@cursor/sdk", () => {
  const Agent = {
    create: vi.fn(),
  };
  class CursorAgentError extends Error {}
  class AuthenticationError extends CursorAgentError {}
  class RateLimitError extends CursorAgentError {}
  class ConfigurationError extends CursorAgentError {}
  class NetworkError extends CursorAgentError {
    isRetryable: boolean;

    constructor(message: string, opts: { isRetryable: boolean }) {
      super(message);
      this.isRetryable = opts.isRetryable;
    }
  }
  return {
    Agent,
    CursorAgentError,
    AuthenticationError,
    RateLimitError,
    ConfigurationError,
    NetworkError,
  };
});

import CustomToolsPlugin from "../.opencode/plugins/custom-tools";

interface FakeLog {
  debug: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
}

interface ToolDefinition {
  execute(args: Record<string, unknown>): Promise<unknown>;
}

function makeContext(): { context: any; log: FakeLog } {
  const log: FakeLog = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  // CustomToolsPlugin が期待する v3 の PluginInput 構造 ({ client: { app: { log } } }) を作成します。
  const context = {
    client: {
      app: { log },
    },
  };
  return { context, log };
}

async function loadTool() {
  const { context, log } = makeContext();
  const plugin = (await CustomToolsPlugin(context)) as Hooks;
  const tool = plugin.tool?.cursor_prompt as unknown as ToolDefinition;
  if (!tool) {
    throw new Error("cursor_prompt tool not found in plugin");
  }
  return { tool, log };
}

describe("cursor_prompt", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("T1: throws and logs error when CURSOR_API_KEY is missing", async () => {
    delete process.env.CURSOR_API_KEY;
    const { tool, log } = await loadTool();

    await expect(tool.execute({ prompt: "hi" })).rejects.toThrow(/CURSOR_API_KEY/);
    expect(log.error).toHaveBeenCalledWith(
      "CURSOR_API_KEY is not set or blank; cursor_prompt cannot run",
      expect.objectContaining({ apiKey: undefined }),
    );
  });

  it("T1.1: throws and logs error when CURSOR_API_KEY is blank", async () => {
    process.env.CURSOR_API_KEY = "   ";
    const { tool, log } = await loadTool();

    await expect(tool.execute({ prompt: "hi" })).rejects.toThrow(/CURSOR_API_KEY/);
    expect(log.error).toHaveBeenCalledWith(
      "CURSOR_API_KEY is not set or blank; cursor_prompt cannot run",
      expect.objectContaining({ apiKey: "   " }),
    );
  });

  it("T2: substitutes DEFAULT_LOCAL_MODEL and warns when model is omitted", async () => {
    process.env.CURSOR_API_KEY = "sk-test-12345";
    const { Agent } = await import("@cursor/sdk");
    const send = vi.fn().mockResolvedValue({
      wait: vi.fn().mockResolvedValue({ id: "run_1", status: "finished", result: "ok" }),
    });
    const close = vi.fn().mockResolvedValue(undefined);
    (Agent.create as ReturnType<typeof vi.fn>).mockResolvedValue({ send, close });

    const { tool, log } = await loadTool();

    const out = await tool.execute({ prompt: "hi" });

    expect(out).toBe("ok");
    expect(Agent.create).toHaveBeenCalledTimes(1);
    const t2CreateArg = (Agent.create as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(t2CreateArg?.model).toEqual({ id: "composer-2" });
    expect(log.warn).toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith("hi");
    expect(close).toHaveBeenCalled();
  });

  it("T3: forwards explicit model to Agent.create as { id } and does not warn", async () => {
    process.env.CURSOR_API_KEY = "sk-test-12345";
    const { Agent } = await import("@cursor/sdk");
    const send = vi.fn().mockResolvedValue({
      wait: vi.fn().mockResolvedValue({ id: "run_2", status: "finished", result: "ok2" }),
    });
    const close = vi.fn().mockResolvedValue(undefined);
    (Agent.create as ReturnType<typeof vi.fn>).mockResolvedValue({ send, close });

    const { tool, log } = await loadTool();

    const out = await tool.execute({ prompt: "hi", model: "composer-explicit-1" });

    expect(out).toBe("ok2");
    expect(Agent.create).toHaveBeenCalledTimes(1);
    const t3CreateArg = (Agent.create as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(t3CreateArg?.model).toEqual({ id: "composer-explicit-1" });
    expect(log.warn).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });

  it("T4: re-throws RateLimitError from agent.send and logs error", async () => {
    process.env.CURSOR_API_KEY = "sk-test-12345";
    const { Agent, RateLimitError } = await import("@cursor/sdk");
    const send = vi.fn().mockRejectedValue(new RateLimitError("rate limited"));
    const close = vi.fn().mockResolvedValue(undefined);
    (Agent.create as ReturnType<typeof vi.fn>).mockResolvedValue({ send, close });

    const { tool, log } = await loadTool();

    await expect(tool.execute({ prompt: "hi" })).rejects.toBeInstanceOf(RateLimitError);
    expect(log.error).toHaveBeenCalled();
  });

  it("T5: re-throws ConfigurationError from Agent.create for unknown model", async () => {
    process.env.CURSOR_API_KEY = "sk-test-12345";
    const { Agent, ConfigurationError } = await import("@cursor/sdk");
    (Agent.create as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ConfigurationError("unknown model"),
    );

    const { tool, log } = await loadTool();

    await expect(tool.execute({ prompt: "hi", model: "no-such-model" })).rejects.toBeInstanceOf(
      ConfigurationError,
    );
    expect(log.error).toHaveBeenCalled();
  });

  it("T6: re-throws AuthenticationError from Agent.create and logs error", async () => {
    process.env.CURSOR_API_KEY = "sk-test-12345";
    const { Agent, AuthenticationError } = await import("@cursor/sdk");
    (Agent.create as ReturnType<typeof vi.fn>).mockRejectedValue(new AuthenticationError("invalid key"));

    const { tool, log } = await loadTool();

    await expect(tool.execute({ prompt: "hi" })).rejects.toBeInstanceOf(AuthenticationError);
    expect(log.error).toHaveBeenCalled();
  });

  it("T6.1: preserves original RateLimitError when agent.close fails", async () => {
    process.env.CURSOR_API_KEY = "sk-test-12345";
    const { Agent, RateLimitError } = await import("@cursor/sdk");
    const send = vi.fn().mockRejectedValue(new RateLimitError("rate limited"));
    const close = vi.fn().mockRejectedValue(new Error("close failed"));
    (Agent.create as ReturnType<typeof vi.fn>).mockResolvedValue({ send, close });

    const { tool, log } = await loadTool();

    await expect(tool.execute({ prompt: "hi" })).rejects.toBeInstanceOf(RateLimitError);
    expect(log.error).toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith("cursor_prompt: agent.close failed", {
      message: "close failed",
    });
  });

  it("T7: re-throws NetworkError and logs isRetryable", async () => {
    process.env.CURSOR_API_KEY = "sk-test-12345";
    const { Agent, NetworkError } = await import("@cursor/sdk");
    const send = vi.fn().mockRejectedValue(new NetworkError("network down", { isRetryable: true }));
    const close = vi.fn().mockResolvedValue(undefined);
    (Agent.create as ReturnType<typeof vi.fn>).mockResolvedValue({ send, close });

    const { tool, log } = await loadTool();

    await expect(tool.execute({ prompt: "hi" })).rejects.toBeInstanceOf(NetworkError);
    const errorCalls = log.error.mock.calls.flat();
    const stringified = JSON.stringify(errorCalls);
    expect(stringified).toContain("isRetryable");
  });

  it("T8: throws and logs when run.status === 'error'", async () => {
    process.env.CURSOR_API_KEY = "sk-test-12345";
    const { Agent } = await import("@cursor/sdk");
    const send = vi.fn().mockResolvedValue({
      wait: vi.fn().mockResolvedValue({ id: "run_err", status: "error" }),
    });
    const close = vi.fn().mockResolvedValue(undefined);
    (Agent.create as ReturnType<typeof vi.fn>).mockResolvedValue({ send, close });

    const { tool, log } = await loadTool();

    await expect(tool.execute({ prompt: "hi" })).rejects.toThrow(/status=error/);
    expect(log.error).toHaveBeenCalledWith("cursor_prompt: run finished with status=error", expect.objectContaining({
      runId: "run_err",
      status: "error",
    }));
    expect(close).toHaveBeenCalled();
  });

  it("T9: throws and logs when run.status === 'cancelled'", async () => {
    process.env.CURSOR_API_KEY = "sk-test-12345";
    const { Agent } = await import("@cursor/sdk");
    const send = vi.fn().mockResolvedValue({
      wait: vi.fn().mockResolvedValue({ id: "run_cxl", status: "cancelled" }),
    });
    const close = vi.fn().mockResolvedValue(undefined);
    (Agent.create as ReturnType<typeof vi.fn>).mockResolvedValue({ send, close });

    const { tool, log } = await loadTool();

    await expect(tool.execute({ prompt: "hi" })).rejects.toThrow(/cancelled/);
    expect(log.warn).toHaveBeenCalledWith("cursor_prompt: run was cancelled", expect.objectContaining({
      runId: "run_cxl",
      status: "cancelled",
    }));
    expect(close).toHaveBeenCalled();
  });

  it("T10: throws and logs when run.status is unexpected", async () => {
    process.env.CURSOR_API_KEY = "sk-test-12345";
    const { Agent } = await import("@cursor/sdk");
    const send = vi.fn().mockResolvedValue({
      wait: vi.fn().mockResolvedValue({ id: "run_unknown", status: "weird" }),
    });
    const close = vi.fn().mockResolvedValue(undefined);
    (Agent.create as ReturnType<typeof vi.fn>).mockResolvedValue({ send, close });

    const { tool, log } = await loadTool();

    await expect(tool.execute({ prompt: "hi" })).rejects.toThrow(/unexpected status \(id=run_unknown, status=weird\)/);
    expect(log.error).toHaveBeenCalledWith("cursor_prompt: unexpected run status", expect.objectContaining({
      runId: "run_unknown",
      status: "weird",
    }));
    expect(close).toHaveBeenCalled();
  });

  it("T10a: agent.close is called on success", async () => {
    process.env.CURSOR_API_KEY = "sk-test-12345";
    const { Agent } = await import("@cursor/sdk");
    const send = vi.fn().mockResolvedValue({
      wait: vi.fn().mockResolvedValue({ id: "run_ok", status: "finished", result: "ok" }),
    });
    const close = vi.fn().mockResolvedValue(undefined);
    (Agent.create as ReturnType<typeof vi.fn>).mockResolvedValue({ send, close });

    const { tool } = await loadTool();
    await tool.execute({ prompt: "hi" });

    expect(close).toHaveBeenCalledTimes(1);
  });

  it("T10b: agent.close is called when send throws", async () => {
    process.env.CURSOR_API_KEY = "sk-test-12345";
    const { Agent, RateLimitError } = await import("@cursor/sdk");
    const send = vi.fn().mockRejectedValue(new RateLimitError("rate"));
    const close = vi.fn().mockResolvedValue(undefined);
    (Agent.create as ReturnType<typeof vi.fn>).mockResolvedValue({ send, close });

    const { tool } = await loadTool();
    await expect(tool.execute({ prompt: "hi" })).rejects.toBeInstanceOf(RateLimitError);

    expect(close).toHaveBeenCalledTimes(1);
  });

  it("T10c: agent is undefined when Agent.create throws; no close call attempted", async () => {
    process.env.CURSOR_API_KEY = "sk-test-12345";
    const { Agent, AuthenticationError } = await import("@cursor/sdk");
    (Agent.create as ReturnType<typeof vi.fn>).mockRejectedValue(new AuthenticationError("invalid"));

    const { tool } = await loadTool();
    await expect(tool.execute({ prompt: "hi" })).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("T11: prompt body is never written to logs", async () => {
    process.env.CURSOR_API_KEY = "sk-test-12345";
    const { Agent } = await import("@cursor/sdk");
    const send = vi.fn().mockResolvedValue({
      wait: vi.fn().mockResolvedValue({
        id: "run_log",
        status: "finished",
        result: "response-content",
      }),
    });
    const close = vi.fn().mockResolvedValue(undefined);
    (Agent.create as ReturnType<typeof vi.fn>).mockResolvedValue({ send, close });

    const { tool, log } = await loadTool();
    await tool.execute({ prompt: "secret-content" });

    const allLogCalls = JSON.stringify([
      ...log.debug.mock.calls,
      ...log.info.mock.calls,
      ...log.warn.mock.calls,
      ...log.error.mock.calls,
    ]);
    expect(allLogCalls).not.toContain("secret-content");
    expect(allLogCalls).not.toContain("response-content");
  });

  it("T12: API key is never written to logs", async () => {
    process.env.CURSOR_API_KEY = "sk-test-12345";
    const { Agent } = await import("@cursor/sdk");
    const send = vi.fn().mockResolvedValue({
      wait: vi.fn().mockResolvedValue({ id: "run_key", status: "finished", result: "ok" }),
    });
    const close = vi.fn().mockResolvedValue(undefined);
    (Agent.create as ReturnType<typeof vi.fn>).mockResolvedValue({ send, close });

    const { tool, log } = await loadTool();
    await tool.execute({ prompt: "hi" });

    const allLogCalls = JSON.stringify([
      ...log.debug.mock.calls,
      ...log.info.mock.calls,
      ...log.warn.mock.calls,
      ...log.error.mock.calls,
    ]);
    expect(allLogCalls).not.toContain("sk-test-12345");
  });
});
