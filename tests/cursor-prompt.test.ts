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

function makeContext(): { context: PluginInput; log: FakeLog } {
  const log: FakeLog = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  // PluginInput として必要な最小限のプロパティをモックし、
  // 元のコードが期待している 'app' プロパティを強引に追加します。
  const context = {
    app: { log },
  } as unknown as PluginInput;
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
});
