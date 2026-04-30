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
});
