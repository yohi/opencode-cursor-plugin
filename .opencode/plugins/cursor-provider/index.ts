import type { Plugin } from "@opencode-ai/plugin";
import { config as loadDotenv } from "dotenv";
import { resolveApiKey, createAuthHook } from "./auth";
import { createAgentPool } from "./agent-pool";
import { createLogger } from "./logger";
import { createProviderHook } from "./provider";
import { STATIC_FALLBACK_MODELS } from "./models";

const POOL_CAPACITY = 8;
const CLOSEALL_TIMEOUT_MS = 5_000;

const CursorProviderPlugin: Plugin = async ({ client }) => {
  if (process.env.NODE_ENV !== "test") {
    loadDotenv();
  }

  const log = createLogger(((client.app as any).log).bind(client.app));
  const pool = createAgentPool({ log, capacity: POOL_CAPACITY });

  const cleanup = async () => {
    let timeoutId: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        pool.closeAll(),
        new Promise<void>((resolve) => {
          timeoutId = setTimeout(resolve, CLOSEALL_TIMEOUT_MS);
        }),
      ]);
    } catch (err) {
      log.warn("cursor-provider: closeAll failed", {
        errorType: err instanceof Error ? err.constructor.name : typeof err,
      });
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  };

  process.once("beforeExit", () => {
    void cleanup();
  });

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, async () => {
      log.info("cursor-provider: signal received, cleaning up", { signal });
      await cleanup();
      process.kill(process.pid, signal);
    });
  }

  return {
    auth: createAuthHook({ log, pool }),
    provider: createProviderHook({ resolveApiKey, log, pool }),
    async config(input: any) {
      if (!input.provider) input.provider = {};
      if (!input.provider.openai) input.provider.openai = {};
      if (!input.provider.openai.models) input.provider.openai.models = {};
      
      for (const model of STATIC_FALLBACK_MODELS) {
        input.provider.openai.models[`cursor-${model.id}`] = {
          name: `Cursor ${model.name}`,
          limit: { context: model.contextWindow, output: 4096 },
        };
      }
    }
  };
};

export default CursorProviderPlugin;
