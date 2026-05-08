import type { Plugin } from "@opencode-ai/plugin";
import { config as loadDotenv } from "dotenv";
import { resolveApiKey, cursorAuthHook, getOrRefreshToken } from "./auth";
import { createAgentPool } from "./agent-pool";
import { ensureCursorProviderConfig } from "./config";
import { createLogger } from "./logger";
import { startOpenAiProxy } from "./openai-proxy";
import { createProviderHook } from "./provider";
import { Cursor } from "@cursor/sdk";
import { STATIC_FALLBACK_MODELS, makeModelMeta } from "./models";

const POOL_CAPACITY = 8;
const CLOSEALL_TIMEOUT_MS = 5_000;

const CursorProviderPlugin: Plugin = async ({ client }) => {
  if (process.env.NODE_ENV !== "test") {
    loadDotenv();
  }

  const log = createLogger((client.app as any).log);
  const pool = createAgentPool({ log, capacity: POOL_CAPACITY });
  const proxy = await startOpenAiProxy(log, pool);

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

  return {
    config: async (config) => {
      // 1. 認証情報を解決（環境変数または保存された情報）
      const savedAuth = await (client.auth as any).get("cursor").catch(() => undefined);
      const resolved = await getOrRefreshToken(savedAuth);
      const apiKey = resolved?.apiKey || process.env.CURSOR_API_KEY;

      let dynamicModels: readonly any[] | null = null;

      // 2. 有効なキー/トークンがあればモデルを取得
      if (apiKey) {
        let timeoutId: NodeJS.Timeout | undefined;
        try {
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
        const modelsObj: Record<string, any> = {};
        
        for (const m of sourceModels) {
          modelsObj[m.id] = makeModelMeta(m);
        }
        config.provider.cursor.models = modelsObj;
      }
    },
    auth: cursorAuthHook,
    provider: createProviderHook({ resolveApiKey, log, pool }),
  };
};

export default CursorProviderPlugin;
