import type { ProviderHook, ProviderHookContext } from "@opencode-ai/plugin";
import type { SDKAgent } from "@cursor/sdk";
import { disposeAgentSafely } from "./agent-cleanup.js";
import type { AgentPool } from "./agent-pool.js";
import { fingerprintApiKey } from "./agent-pool.js";
import { classifyError, logError } from "./errors.js";
import type { Logger } from "./logger.js";
import { STATIC_FALLBACK_MODELS, makeModelMeta, type FallbackModel } from "./models.js";
import { createStream } from "./stream-proxy.js";
import { translate, type LanguageModelV2Prompt } from "./translator.js";

const MODELS_LIST_TIMEOUT_MS = 10_000;
type RawSDKModel = {
  id?: string;
  modelId?: string;
  name?: string;
  displayName?: string;
  contextWindow?: number;
  [key: string]: unknown;
};

async function listModelsWithTimeout(apiKey: string, log: Logger): Promise<FallbackModel[] | null> {
  const { Cursor } = await import("@cursor/sdk");
  let timeoutId: NodeJS.Timeout | undefined;
  try {
    const rawModels = await Promise.race([
      Cursor.models.list({ apiKey }) as unknown as Promise<RawSDKModel[] | undefined | null>,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error("models.list timeout")), MODELS_LIST_TIMEOUT_MS);
      }),
    ]);
    if (!rawModels) return null;

    return rawModels.map((raw) => {
      const id = raw.id ?? raw.modelId;
      const name = raw.name ?? raw.displayName ?? id;
      return {
        ...raw,
        id: id ?? "unknown",
        name: name ?? "Unknown Model",
        contextWindow: raw.contextWindow ?? 200_000,
      } as FallbackModel;
    });
  } catch (err) {
    log.warn("cursor-provider: models.list failed; using static fallback", {
      errorType: err instanceof Error ? err.constructor.name : typeof err,
    });
    return null;
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

export function createProviderHook(deps: {
  resolveApiKey: (ctx: ProviderHookContext, log?: Logger) => Promise<string | undefined>;
  log: Logger;
  pool: AgentPool;
}): ProviderHook {
  const { resolveApiKey, log, pool } = deps;
  let warnedParamsOnce = false;

  return {
    id: "cursor",
    async models(_provider: unknown, ctx: ProviderHookContext) {
      const apiKey = await resolveApiKey(ctx, log);
      const dynamicModels = apiKey ? await listModelsWithTimeout(apiKey, log) : null;
      const sourceModels = dynamicModels ?? STATIC_FALLBACK_MODELS;

      const result: Record<string, any> = Object.create(null);
      for (const rawModel of sourceModels) {
        const id = rawModel.id;
        if (!id || id === "__proto__" || id === "constructor" || id === "prototype") continue;

        const meta = makeModelMeta({
          ...rawModel,
          id,
          name: rawModel.name,
          contextWindow: rawModel.contextWindow,
        });

        result[id] = {
          ...meta,
          async doStream(args: { prompt: LanguageModelV2Prompt; abortSignal?: AbortSignal; chatParams?: unknown }) {
            try {
              const currentApiKey = await resolveApiKey(ctx, log);
              return await runDoStream({
                args,
                modelId: id,
                apiKey: currentApiKey,
                log,
                pool,
                warnState: {
                  hasWarned: () => warnedParamsOnce,
                  markWarned: () => {
                    warnedParamsOnce = true;
                  },
                },
              });
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              log.error("cursor-provider: doStream threw an error", { message });
              
              // Instead of returning a stream with an error object, which might crash opencode core if it expects a specific format,
              // we throw a standard Error object so that the Provider framework handles the rejection natively.
              throw new Error(`Cursor Provider Error: ${message}`);
            }
          },
        };
      }

      return result;
    },
  };
}

async function getValidCursorModels(apiKey: string | undefined, log: Logger): Promise<Set<string>> {
  const allowedFromEnv = process.env.CURSOR_ALLOWED_MODELS;
  const envModels = allowedFromEnv ? new Set(allowedFromEnv.split(",").map(m => m.trim()).filter(Boolean)) : new Set<string>();

  let sdkModels: FallbackModel[] | null = null;
  if (apiKey) {
    sdkModels = await listModelsWithTimeout(apiKey, log);
  }

  const validSet = new Set<string>(envModels);
  if (sdkModels) {
    for (const m of sdkModels) validSet.add(m.id);
  }

  // If both empty, fallback to static list
  if (validSet.size === 0) {
    for (const m of STATIC_FALLBACK_MODELS) validSet.add(m.id);
  }

  return validSet;
}

async function runDoStream(opts: {
  args: { prompt: LanguageModelV2Prompt; abortSignal?: AbortSignal; chatParams?: unknown };
  modelId: string;
  apiKey: string | undefined;
  log: Logger;
  pool: AgentPool;
  warnState: { hasWarned: () => boolean; markWarned: () => void };
}) {
  const { args, apiKey, log, pool, warnState } = opts;
  let { modelId } = opts;

  const validSet = await getValidCursorModels(apiKey, log);
  if (!validSet.has(modelId)) {
    // Only remap if we have a fallback, otherwise proceed but warn
    if (validSet.has("composer-2")) {
      log.warn("cursor-provider: mapping unknown model to composer-2", { originalModel: modelId });
      modelId = "composer-2";
    } else {
      log.warn("cursor-provider: proceeding with unknown model (no fallback found)", { modelId });
    }
  }

  if (!apiKey) {
    log.error("cursor-provider: doStream invoked without API key");
    throw new Error("Cursor API key is not set; run 'opencode auth login cursor' or export CURSOR_API_KEY");
  }

  if (!warnState.hasWarned() && args.chatParams && Object.keys(args.chatParams as Record<string, unknown>).length > 0) {
    warnState.markWarned();
    log.warn("cursor-provider: chat.params not supported by Cursor SDK; ignored", {
      paramKeys: Object.keys(args.chatParams as Record<string, unknown>),
    });
  }

  const translated = translate(args.prompt);
  const fingerprint = fingerprintApiKey(apiKey);
  const hit = pool.tryGet(translated.prefixHash, modelId, apiKey);
  let agent: SDKAgent;
  let messageToSend: string;

  if (hit) {
    agent = hit.agent as SDKAgent;
    messageToSend = translated.latestUserMessage;
    log.debug("cursor-provider: pool hit", { prefixHash: translated.prefixHash.slice(0, 8) });
  } else {
    agent = await createAgentWithRetry({ apiKey, modelId, log });
    messageToSend = translated.fullPromptOnMiss;
    log.debug("cursor-provider: pool miss", { prefixHash: translated.prefixHash.slice(0, 8) });
  }

  let replacedAgent: SDKAgent | undefined;
  const recreateAgent = hit
    ? async () => {
        await disposeAgentSafely(agent, log);
        const fresh = await createAgentWithRetry({ apiKey, modelId, log });
        replacedAgent = fresh;
        return { agent: fresh, message: translated.fullPromptOnMiss };
      }
    : undefined;

  const { stream, done } = createStream({
    agent,
    message: messageToSend,
    log,
    abortSignal: args.abortSignal,
    recreateAgent,
  });

  void done
    .then(async ({ finishReason, errorType }) => {
      const finalAgent = replacedAgent || agent;
      if (finishReason === "stop") {
        await pool.put(translated.nextHash, {
          agent: finalAgent,
          lastUsedAt: Date.now(),
          modelId,
          apiKeyFingerprint: fingerprint,
        });
        return;
      }

      if (errorType) {
        log.debug("cursor-provider: stream ended with errorType", { errorType });
      }

      await disposeAgentSafely(finalAgent, log);
    })
    .catch((err) => {
      logError(log, err, { phase: "post-stream" });
    });

  return { stream };
}

async function createAgentWithRetry(deps: { apiKey: string; modelId: string; log: Logger }): Promise<SDKAgent> {
  const { Agent } = await import("@cursor/sdk");
  const { apiKey, modelId, log } = deps;
  const maxRetries = 3;
  let attempt = 0;

  while (attempt < maxRetries) {
    attempt++;
    try {
      log.debug("cursor-provider: calling Agent.create (local mode)", { modelId });

      return (await Agent.create({
        apiKey,
        model: { id: modelId },
      })) as SDKAgent;
    } catch (err) {
      const decision = classifyError(err, { phase: "create" });
      const canRetry = attempt < maxRetries && decision.retry;
      const errObj = (typeof err === "object" && err !== null) ? (err as Record<string, unknown>) : {};

      logError(log, err, {
        phase: "create",
        model: modelId,
        attempt,
        maxRetries,
        canRetry,
        details: errObj.details,
      });

      if (!canRetry) throw err;

      // Exponential backoff: 2s, 4s, 8s... modified by base delayMs
      const backoffDelay = decision.delayMs * Math.pow(2, attempt - 1);
      log.info(`cursor-provider: retrying in ${backoffDelay}ms...`);
      await new Promise((resolve) => setTimeout(resolve, backoffDelay));
    }
  }
  // This point is only reached if all retry attempts fail or a non-retryable error occurs.
  // The error is thrown to be handled by the caller (e.g., doStream's try-catch).
  throw new Error("Agent creation failed after reaching maximum retries");
}
