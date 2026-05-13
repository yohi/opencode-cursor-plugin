import type { Config, Plugin, ProviderHookContext } from "@opencode-ai/plugin";
import { config as loadDotenv } from "dotenv";
import { createAgentPool } from "./agent-pool.js";
import { cursorAuthHook, resolveApiKey } from "./auth.js";
import { ensureCursorProviderConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { STATIC_FALLBACK_MODELS, makeModelMeta } from "./models.js";
import { startOpenAiProxy } from "./openai-proxy.js";
import { createProviderHook } from "./provider.js";

const POOL_CAPACITY = 10;

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

	const rawLog = client.app.log;
	const log = createLogger(
		typeof rawLog === "function" ? rawLog.bind(client.app) : rawLog,
	);
	const pool = createAgentPool({ log, capacity: POOL_CAPACITY });
	const proxy = await startOpenAiProxy(log, pool);

	return {
		config: async (config: Config) => {
			// Set CURSOR_REPO_URL from config if present
			const cursorOpts = config.provider?.cursor?.options as
				| Record<string, unknown>
				| undefined;
			const repoUrl = cursorOpts?.repoUrl;
			if (repoUrl && typeof repoUrl === "string") {
				process.env.CURSOR_REPO_URL = repoUrl;
				log.debug("cursor-provider: repoUrl set from config", { repoUrl });
			}

			const repoBranch = cursorOpts?.repoBranch;
			if (repoBranch && typeof repoBranch === "string") {
				process.env.CURSOR_REPO_BRANCH = repoBranch;
				log.debug("cursor-provider: repoBranch set from config", {
					repoBranch,
				});
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
