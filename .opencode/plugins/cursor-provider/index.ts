import type { Plugin } from "@opencode-ai/plugin";
import { config as loadDotenv } from "dotenv";
import { resolveApiKey, cursorAuthHook } from "./auth";
import { createAgentPool } from "./agent-pool";
import { createLogger } from "./logger";
import { createProviderHook } from "./provider";

const POOL_CAPACITY = 8;
const CLOSEALL_TIMEOUT_MS = 5_000;

const CursorProviderPlugin: Plugin = async ({ client }) => {
  if (process.env.NODE_ENV !== "test") {
    loadDotenv();
  }

  const log = createLogger((client.app as any).log);
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
    auth: cursorAuthHook,
    provider: createProviderHook({ resolveApiKey, log, pool }),
  };
};

export default CursorProviderPlugin;
