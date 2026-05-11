import type { Plugin, ProviderHookContext, Config } from "@opencode-ai/plugin";
import { config as loadDotenv } from "dotenv";
import { resolveApiKey, cursorAuthHook } from "./auth.js";
import { createAgentPool } from "./agent-pool.js";
import { ensureCursorProviderConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { startOpenAiProxy } from "./openai-proxy.js";
import { createProviderHook } from "./provider.js";
import { STATIC_FALLBACK_MODELS, makeModelMeta } from "./models.js";

const POOL_CAPACITY = 8;

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
  const proxy = await startOpenAiProxy(log, pool);

  return {
    config: async (config: Config) => {
      // Set CURSOR_REPO_URL from config if present
      const repoUrl = (config as any).provider?.cursor?.options?.repoUrl;
      if (repoUrl && typeof repoUrl === "string") {
        process.env.CURSOR_REPO_URL = repoUrl;
        log.debug("cursor-provider: repoUrl set from config", { repoUrl });
      }

      const repoBranch = (config as any).provider?.cursor?.options?.repoBranch;
      if (repoBranch && typeof repoBranch === "string") {
        process.env.CURSOR_REPO_BRANCH = repoBranch;
        log.debug("cursor-provider: repoBranch set from config", { repoBranch });
      }

      ensureCursorProviderConfig(config, { baseURL: proxy.baseURL });

      // Inject models if already configured to show them in the UI immediately
      if (config.provider?.cursor) {
        const models = config.provider.cursor.models || {};
        const sourceModels = STATIC_FALLBACK_MODELS;
        for (const m of sourceModels) {
          if (!models[m.id]) {
            models[m.id] = makeModelMeta(m);
          }
        }
        config.provider.cursor.models = models;
      }
    },
    auth: cursorAuthHook,
    provider: createProviderHook({ resolveApiKey, log, pool }),
  };
};

export default CursorProviderPlugin;
