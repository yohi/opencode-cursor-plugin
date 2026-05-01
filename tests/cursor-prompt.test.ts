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

function makeContext(): { context: any; log: FakeLog } {
  const log: FakeLog = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  return { context: { app: { log } }, log };
}

async function loadTool() {
  const { context, log } = makeContext();
  const plugin = await CustomToolsPlugin(context);
  return { tool: (plugin as any).tool.cursor_prompt, log };
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
});
