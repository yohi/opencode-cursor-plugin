import type { ProviderHook, ProviderHookContext } from "@opencode-ai/plugin";
import type { SDKAgent } from "@cursor/sdk";
import { setTimeout } from "node:timers/promises";

// Extract ModelV2 type from ProviderHook definition
type ProviderModelsFn = NonNullable<ProviderHook["models"]>;
type ExtractedModelV2 = NonNullable<Awaited<ReturnType<ProviderModelsFn>>[string]>;

import { disposeAgentSafely } from "./agent-cleanup.js";
import type { AgentPool } from "./agent-pool.js";
import { fingerprintApiKey } from "./agent-pool.js";
import { classifyError, logError } from "./errors.js";
import type { Logger } from "./logger.js";
import { STATIC_FALLBACK_MODELS, makeModelMeta, type FallbackModel } from "./models.js";
import { createStream } from "./stream-proxy.js";
import { translate, type ModelV2Prompt } from "./translator.js";

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
        timeoutId = globalThis.setTimeout(() => {
          reject(new Error("models.list timeout"));
        }, MODELS_LIST_TIMEOUT_MS);
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
    if (timeoutId !== undefined) globalThis.clearTimeout(timeoutId);
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

      const modelMap = new Map<string, ExtractedModelV2>();
      for (const rawModel of sourceModels) {
        const id = rawModel.id;
        if (!id || typeof id !== "string" || id === "__proto__" || id === "constructor" || id === "prototype") {
          continue;
        }

        modelMap.set(
          id,
          createLanguageModel({
            rawModel,
            ctx,
            log,
            pool,
            resolveApiKey,
            warnState: {
              hasWarned: () => warnedParamsOnce,
              markWarned: () => {
                warnedParamsOnce = true;
              },
            },
          }),
        );
      }

      return Object.fromEntries(modelMap) as Record<string, ExtractedModelV2>;
    },
  };
}

function createLanguageModel(deps: {
  rawModel: FallbackModel;
  ctx: ProviderHookContext;
  log: Logger;
  pool: AgentPool;
  resolveApiKey: (ctx: ProviderHookContext, log?: Logger) => Promise<string | undefined>;
  warnState: { hasWarned: () => boolean; markWarned: () => void };
}): ExtractedModelV2 & {
  doStream(args: {
    prompt: ModelV2Prompt;
    abortSignal?: AbortSignal;
    chatParams?: unknown;
  }): Promise<{ stream: ReadableStream }>;
} {
  const { rawModel, ctx, log, pool, resolveApiKey, warnState } = deps;
  const id = rawModel.id;

  const meta = makeModelMeta({
    ...rawModel,
    id,
    name: rawModel.name,
    contextWindow: rawModel.contextWindow,
  });

  return {
    ...meta,
    async doStream(args: { prompt: ModelV2Prompt; abortSignal?: AbortSignal; chatParams?: unknown }) {
      try {
        const currentApiKey = await resolveApiKey(ctx, log);
        return await runDoStream({
          args,
          modelId: id,
          apiKey: currentApiKey,
          log,
          pool,
          warnState,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error("cursor-provider: doStream threw an error", { message });
        return Promise.reject(new Error(`Cursor Provider Error: ${message}`));
      }
    },
  } as ExtractedModelV2 & {
    doStream(args: {
      prompt: ModelV2Prompt;
      abortSignal?: AbortSignal;
      chatParams?: unknown;
    }): Promise<{ stream: ReadableStream }>;
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

  if (validSet.size === 0) {
    for (const m of STATIC_FALLBACK_MODELS) validSet.add(m.id);
  }

  return validSet;
}

function validateAndMapModel(modelId: string, validSet: Set<string>, log: Logger): string {
  if (validSet.has(modelId)) return modelId;

  if (validSet.has("composer-2")) {
    log.warn("cursor-provider: mapping unknown model to composer-2", { originalModel: modelId });
    return "composer-2";
  }

  log.warn("cursor-provider: proceeding with unknown model (no fallback found)", { modelId });
  return modelId;
}

/**
 * Handles the logic after a stream has finished, including pooling or disposing the agent.
 */
async function handleStreamFinish(deps: {
  finishReason: string;
  errorType?: string;
  agent: SDKAgent;
  pool: AgentPool;
  nextHash: string;
  modelId: string;
  apiKeyFingerprint: string;
  log: Logger;
}) {
  const { finishReason, errorType, agent, pool, nextHash, modelId, apiKeyFingerprint, log } = deps;

  if (finishReason === "stop") {
    await pool.put(nextHash, {
      agent,
      lastUsedAt: Date.now(),
      modelId,
      apiKeyFingerprint,
    });
    return;
  }

  if (errorType) {
    log.debug("cursor-provider: stream ended with errorType", { errorType });
  }

  await disposeAgentSafely(agent, log);
}

/**
 * Resolves which agent to use (pooled vs new) and the message to send.
 */
async function resolveAgentAndMessage(deps: {
  apiKey: string;
  modelId: string;
  translated: ReturnType<typeof translate>;
  pool: AgentPool;
  log: Logger;
}): Promise<{ agent: SDKAgent; message: string; isHit: boolean }> {
  const { apiKey, modelId, translated, pool, log } = deps;
  const hit = pool.tryGet(translated.prefixHash, modelId, apiKey);

  if (hit) {
    log.debug("cursor-provider: pool hit", { prefixHash: translated.prefixHash.slice(0, 8) });
    return {
      agent: hit.agent as SDKAgent,
      message: translated.latestUserMessage,
      isHit: true,
    };
  }

  log.debug("cursor-provider: pool miss", { prefixHash: translated.prefixHash.slice(0, 8) });
  const agent = await createAgentWithRetry({ apiKey, modelId, log });
  return {
    agent,
    message: translated.fullPromptOnMiss,
    isHit: false,
  };
}

async function runDoStream(opts: {
  args: { prompt: ModelV2Prompt; abortSignal?: AbortSignal; chatParams?: unknown };
  modelId: string;
  apiKey: string | undefined;
  log: Logger;
  pool: AgentPool;
  warnState: { hasWarned: () => boolean; markWarned: () => void };
}) {
  const { args, apiKey, log, pool, warnState } = opts;
  let { modelId } = opts;

  const validSet = await getValidCursorModels(apiKey, log);
  modelId = validateAndMapModel(modelId, validSet, log);

  if (!apiKey) {
    log.error("cursor-provider: doStream invoked without API key");
    return Promise.reject(new Error("Cursor API key is not set"));
  }

  if (!warnState.hasWarned() && args.chatParams && Object.keys(args.chatParams as Record<string, unknown>).length > 0) {
    warnState.markWarned();
    log.warn("cursor-provider: chat.params ignored", { paramKeys: Object.keys(args.chatParams as Record<string, unknown>) });
  }

  const translated = translate(args.prompt);
  const { agent, message, isHit } = await resolveAgentAndMessage({ apiKey, modelId, translated, pool, log });

  let replacedAgent: SDKAgent | undefined;
  const recreateAgent = isHit
    ? async () => {
        await disposeAgentSafely(agent, log);
        replacedAgent = await createAgentWithRetry({ apiKey, modelId, log });
        return { agent: replacedAgent, message: translated.fullPromptOnMiss };
      }
    : undefined;

  const { stream, done } = createStream({ agent, message, log, abortSignal: args.abortSignal, recreateAgent });

  void done
    .then((res) =>
      handleStreamFinish({
        ...res,
        agent: replacedAgent || agent,
        pool,
        nextHash: translated.nextHash,
        modelId,
        apiKeyFingerprint: fingerprintApiKey(apiKey),
        log,
      }),
    )
    .catch((err) => logError(log, err, { phase: "post-stream" }));

  return { stream };
}

/**
 * Single attempt to create an agent with error classification and logging.
 */
async function performAgentCreationAttempt(deps: {
  Agent: any;
  apiKey: string;
  modelId: string;
  log: Logger;
  attempt: number;
}): Promise<{ agent: SDKAgent } | { error: any; canRetry: boolean; delay: number }> {
  const { Agent, apiKey, modelId, log, attempt } = deps;
  try {
    log.debug("cursor-provider: calling Agent.create", { modelId, attempt });
    const agent = (await Agent.create({ apiKey, model: { id: modelId } })) as SDKAgent;
    return { agent };
  } catch (err) {
    const decision = classifyError(err, { phase: "create" });
    const canRetry = attempt < 3 && decision.retry;
    logError(log, err, { phase: "create", model: modelId, attempt, maxRetries: 3, canRetry });

    return {
      error: err,
      canRetry,
      delay: decision.delayMs * Math.pow(2, attempt - 1),
    };
  }
}

async function createAgentWithRetry(deps: { apiKey: string; modelId: string; log: Logger }): Promise<SDKAgent> {
  const { Agent } = await import("@cursor/sdk");
  const { log } = deps;

  for (let attempt = 1; attempt <= 3; attempt++) {
    const result = await performAgentCreationAttempt({ Agent, ...deps, attempt });

    if ("agent" in result) return result.agent;
    if (!result.canRetry) return Promise.reject(result.error);

    log.info(`cursor-provider: retrying in ${result.delay}ms...`);
    await setTimeout(result.delay);
  }

  return Promise.reject(new Error("Agent creation failed after maximum retries"));
}
