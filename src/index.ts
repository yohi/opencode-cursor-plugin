import type { Plugin, ProviderHookContext } from "@opencode-ai/plugin";
import { config as loadDotenv } from "dotenv";
import { resolveApiKey, cursorAuthHook, getOrRefreshToken, getTokenExpiry, resolveAndPersistApiKey } from "./auth.js";
import { createAgentPool } from "./agent-pool.js";
import { ensureCursorProviderConfig } from "./config.js";
import { createLogger, type RawLogFn, type RawLogMethods } from "./logger.js";
import { startOpenAiProxy } from "./openai-proxy.js";
import { createProviderHook } from "./provider.js";
import { STATIC_FALLBACK_MODELS, makeModelMeta, type ModelMeta } from "./models.js";

const POOL_CAPACITY = 8;
const CLOSEALL_TIMEOUT_MS = 5_000;

/**
 * OpenCode client with extended properties used by this plugin.
 */
interface ExtendedClient {
  app: {
    log: Parameters<typeof createLogger>[0];
    cwd?: string;
  };
  auth?: unknown;
}

const CursorProviderPlugin: Plugin = async (input) => {
  const client = input.client as ExtendedClient;

  if (process.env.NODE_ENV !== "test") {
    loadDotenv();
  }

  const log = createLogger(typeof client.app.log === "function" ? (client.app.log as Function).bind(client.app) : client.app.log);
  const pool = createAgentPool({ log, capacity: POOL_CAPACITY });
  const cwd = client.app.cwd || process.cwd();
  const proxy = await startOpenAiProxy(log, pool, cwd);

  const cleanup = async () => {
    let timeoutId: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        Promise.all([pool.closeAll(), proxy.close()]),
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

  const auth = client.auth;

  return {
    config: async (config) => {
      // 1. 認証情報を解決
      const apiKey = await resolveAndPersistApiKey({ auth, log });

      let dynamicModels: readonly any[] | null = null;

      // 2. 有効なキー/トークンがあればモデルを取得
      if (apiKey) {
        let timeoutId: NodeJS.Timeout | undefined;
        try {
          const { Cursor } = await import("@cursor/sdk");
          const list = await Promise.race([
            Cursor.models.list({ apiKey }),
            new Promise<never>((_, reject) => {
              timeoutId = setTimeout(() => reject(new Error("models.list timeout")), 10_000);
            }),
          ]);
          dynamicModels = list;
        } catch {
          // Discovery failed or timed out
          dynamicModels = STATIC_FALLBACK_MODELS;
        } finally {
          if (timeoutId) clearTimeout(timeoutId);
        }
      }

      ensureCursorProviderConfig(config, { baseURL: proxy.baseURL });

      if (config.provider?.cursor) {
        const sourceModels = (dynamicModels && dynamicModels.length > 0) ? dynamicModels : STATIC_FALLBACK_MODELS;
        const modelsObj: Record<string, ModelMeta> = {};
        for (const m of sourceModels) {
          modelsObj[m.id] = makeModelMeta(m);
        }
        config.provider.cursor.models = modelsObj;
      }
    },
    auth: cursorAuthHook,
    provider: createProviderHook({ resolveApiKey, log, pool, cwd }),
  };
};

export default CursorProviderPlugin;
