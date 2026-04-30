import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

function makeClient(): { client: { app: { log: FakeLog } }; log: FakeLog } {
  const log: FakeLog = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  return { client: { app: { log } }, log };
}

async function loadTool() {
  const { client, log } = makeClient();
  const plugin = await CustomToolsPlugin({ client } as never);
  return { tool: plugin.tool.cursor_prompt, log };
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
    expect(log.error).toHaveBeenCalledTimes(1);
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

    const out = await tool.execute({ prompt: "hi", model: "composer-2" });

    expect(out).toBe("ok2");
    expect(Agent.create).toHaveBeenCalledTimes(1);
    const t3CreateArg = (Agent.create as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(t3CreateArg?.model).toEqual({ id: "composer-2" });
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("T4: re-throws RateLimitError from agent.send and logs error", async () => {
    process.env.CURSOR_API_KEY = "sk-test-12345";
    const { Agent, RateLimitError } = await import("@cursor/sdk");
    const send = vi.fn().mockRejectedValue(new RateLimitError("rate limited"));
    const close = vi.fn().mockResolvedValue(undefined);
    (Agent.create as ReturnType<typeof vi.fn>).mockResolvedValue({ send, close });

    const { tool, log } = await loadTool();

    await expect(tool.execute({ prompt: "x".repeat(1_000_000) })).rejects.toBeInstanceOf(RateLimitError);
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

  it("T6: re-throws AuthenticationError from Agent.create", async () => {
    process.env.CURSOR_API_KEY = "sk-test-12345";
    const { Agent, AuthenticationError } = await import("@cursor/sdk");
    (Agent.create as ReturnType<typeof vi.fn>).mockRejectedValue(new AuthenticationError("invalid key"));

    const { tool } = await loadTool();

    await expect(tool.execute({ prompt: "hi" })).rejects.toBeInstanceOf(AuthenticationError);
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
    expect(log.error).toHaveBeenCalled();
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
    expect(log.error).toHaveBeenCalled();
  });
});
