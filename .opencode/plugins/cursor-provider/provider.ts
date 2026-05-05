const MODELS_LIST_TIMEOUT_MS = 5_000;

async function listModelsWithTimeout(apiKey: string, log: any) {
  const { Cursor } = await import("@cursor/sdk");
  let timeoutId: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      Cursor.models.list({ apiKey }),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error("models.list timeout")), MODELS_LIST_TIMEOUT_MS);
      }),
    ]);
  } catch (err) {
    log.warn("cursor-provider: models.list failed; using static fallback", {
      errorType: err instanceof Error ? err.constructor.name : typeof err,
    });
    return null;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export function createProviderHook(deps: {
  resolveApiKey: (ctx: any) => Promise<string | undefined>;
  log: any;
  pool: any;
}): any {
  const { resolveApiKey, log, pool } = deps;
  let warnedParamsOnce = false;

  return {
    id: "cursor-provider",
    async models(_provider: any, ctx: any) {
      const { STATIC_FALLBACK_MODELS, makeModelMeta } = await import("./models.js");
      const apiKey = await resolveApiKey(ctx);
      const dynamicModels = apiKey ? await listModelsWithTimeout(apiKey, log) : null;
      const sourceModels = dynamicModels ?? STATIC_FALLBACK_MODELS;

      const result: Record<string, any> = {};
      for (const model of sourceModels as Array<{ id: string; name?: string; contextWindow?: number }>) {
        const meta = makeModelMeta({
          id: model.id,
          name: model.name ?? model.id,
          contextWindow: model.contextWindow ?? 200_000,
        });

        result[model.id] = {
          ...meta,
          async doStream(args: any) {
            const currentApiKey = await resolveApiKey(ctx);
            const [{ translate }, { fingerprintApiKey }, { createStream }, { disposeAgentSafely }, { logError }] = await Promise.all([
              import("./translator.js"),
              import("./agent-pool.js"),
              import("./stream-proxy.js"),
              import("./agent-cleanup.js"),
              import("./errors.js"),
            ]);

            return runDoStream({
              args,
              modelId: model.id,
              apiKey: currentApiKey,
              log,
              pool,
              translate,
              fingerprintApiKey,
              createStream,
              disposeAgentSafely,
              logError,
              warnState: {
                hasWarned: () => warnedParamsOnce,
                markWarned: () => {
                  warnedParamsOnce = true;
                },
              },
            });
          },
        };
      }

      return result;
    },
  };
}

async function runDoStream(opts: any) {
  const { args, modelId, apiKey, log, pool, translate, fingerprintApiKey, createStream, disposeAgentSafely, logError, warnState } = opts;
  if (!apiKey) {
    log.error("cursor-provider: doStream invoked without API key");
    throw new Error("Cursor API key is not set; run 'opencode auth login cursor-provider' or export CURSOR_API_KEY");
  }

  if (!warnState.hasWarned() && args.chatParams && Object.keys(args.chatParams).length > 0) {
    warnState.markWarned();
    log.warn("cursor-provider: chat.params not supported by Cursor SDK; ignored", {
      paramKeys: Object.keys(args.chatParams),
    });
  }

  const translated = translate(args.prompt);
  const fingerprint = fingerprintApiKey(apiKey);
  const hit = pool.tryGet(translated.prefixHash, modelId, apiKey);
  let agent: any;
  let messageToSend: string;

  if (hit) {
    agent = hit.agent;
    messageToSend = translated.latestUserMessage;
    log.debug("cursor-provider: pool hit", { prefixHash: translated.prefixHash.slice(0, 8) });
  } else {
    agent = await createAgentWithRetry({ apiKey, modelId, log });
    messageToSend = translated.fullPromptOnMiss;
    log.debug("cursor-provider: pool miss", { prefixHash: translated.prefixHash.slice(0, 8) });
  }

  let replacedAgent: any;
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
    .then(async ({ finishReason, errorType }: any) => {
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
    .catch((err: any) => {
      logError(log, err, { phase: "post-stream" });
    });

  return { stream };
}

async function createAgentWithRetry(deps: { apiKey: string; modelId: string; log: any }) {
  const { Agent } = await import("@cursor/sdk");
  const { classifyError, logError } = await import("./errors.js");
  const { apiKey, modelId, log } = deps;
  try {
    return await Agent.create({ apiKey, model: { id: modelId }, local: { cwd: process.cwd() } });
  } catch (err) {
    const decision = classifyError(err, { phase: "create" });
    logError(log, err, { phase: "create", retry: decision.retry });
    if (!decision.retry) throw err;

    await new Promise((resolve) => setTimeout(resolve, decision.delayMs));
    return Agent.create({ apiKey, model: { id: modelId }, local: { cwd: process.cwd() } });
  }
}
