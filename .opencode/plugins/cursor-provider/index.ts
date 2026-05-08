import type { Plugin } from "@opencode-ai/plugin";
import { config as loadDotenv } from "dotenv";
import { resolveApiKey, cursorAuthHook } from "./auth";
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
  const proxy = await startOpenAiProxy(log);

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
      let apiKey = process.env.CURSOR_API_KEY;
      
      if (!apiKey) {
        try {
          const auth = await (client.auth as any).get("cursor");
          if (auth?.type === "api") {
            apiKey = auth.key;
          } else if (auth?.type === "oauth") {
            apiKey = auth.access;
          }
        } catch {
          // No saved auth yet
        }
      }

      let dynamicModels: any[] | null = null;

      // 2. 有効なキー/トークンがあればモデルを取得
      if (apiKey) {
        try {
          dynamicModels = await Cursor.models.list({ apiKey });
        } catch {
          // Discovery failed (e.g. network error or expired token)
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
