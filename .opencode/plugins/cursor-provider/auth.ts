import type { AuthHook, ProviderHookContext } from "@opencode-ai/plugin";
import type { Logger } from "./logger";
import type { AgentPool } from "./agent-pool";
import { listModelsWithTimeout, runDoStream } from "./provider";
import { STATIC_FALLBACK_MODELS, makeModelMeta } from "./models";
export async function resolveApiKey(ctx: ProviderHookContext): Promise<string | undefined> {
  try {
    const fromContext = await (ctx.auth as any)?.get?.("cursor");
    if (fromContext?.type === "api") {
      const key = typeof fromContext.key === "string" ? fromContext.key.trim() : "";
      if (key) return key;
    }
  } catch (err) {
    // OpenCode runtime からの例外（ctx.auth.get が存在しない、または呼び出し失敗）をキャッチし、
    // 環境変数 CURSOR_API_KEY によるフォールバックを継続させる。
    // プログラム上の致命的なエラー（TypeError等）をマスクする可能性があるが、現状は安全性を優先。
  }

  const fromEnv = process.env.CURSOR_API_KEY?.trim();
  return fromEnv ? fromEnv : undefined;
}

export function createAuthHook(deps: { log: Logger; pool: AgentPool }): AuthHook {
  const { log, pool } = deps;
  return {
    provider: "openai",
    methods: [
      {
        type: "api",
        label: "Cursor API key",
        prompts: [
          {
            key: "key",
            message: "Cursor API key",
            type: "text",
          },
        ],
      },
    ],
    loader: async (getAuth, provider) => {
      const mockCtx = { auth: { get: () => getAuth() } };
      const _fetch = globalThis.fetch;
      
      return {
        async fetch(input: any, init?: any) {
          try {
            const urlStr = input.toString();
            console.error(`>>> FETCH INTERCEPTED [this=${typeof this}]:`, urlStr);
            if (!urlStr.includes("api.openai.com")) {
              return _fetch.call(globalThis, input, init);
            }

            const reqBody = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body;
            console.error(">>> reqBody is:", JSON.stringify(reqBody));
            if (!reqBody?.model?.startsWith("cursor-")) {
               return _fetch.call(globalThis, input, init);
            }
            
            const currentApiKey = await resolveApiKey(mockCtx);
            console.error(">>> Resolved API Key length:", currentApiKey?.length ?? 0);

            const prompt = [...(reqBody.input || reqBody.messages || [])];
            if (reqBody.instructions) {
              prompt.unshift({ role: "system", content: reqBody.instructions });
            }

            const { stream } = await runDoStream({
              args: { prompt, abortSignal: init?.signal },
              modelId: reqBody?.model?.replace("cursor-", "") ?? "composer-2",
              apiKey: currentApiKey,
              log,
              pool,
              warnState: { hasWarned: () => false, markWarned: () => {} },
            });

          const encoder = new TextEncoder();
          const byteStream = new ReadableStream({
            async start(controller) {
              const reader = stream.getReader();
              try {
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;

                  if (value.type === "text-delta" || value.type === "reasoning-delta") {
                    // For reasoning-delta, some OpenAI clients support it if passed in delta, but let's just append to text for now or pass content.
                    // If reasoning is separate, we'd need a different field, but standard is content.
                    const chunk = {
                      id: "chatcmpl-cursor",
                      object: "chat.completion.chunk",
                      created: Math.floor(Date.now() / 1000),
                      model: reqBody.model,
                      choices: [
                        {
                          index: 0,
                          delta: { content: value.text },
                          finish_reason: null,
                        },
                      ],
                    };
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
                  } else if (value.type === "finish") {
                    const chunk = {
                      id: "chatcmpl-cursor",
                      object: "chat.completion.chunk",
                      created: Math.floor(Date.now() / 1000),
                      model: reqBody.model,
                      choices: [
                        {
                          index: 0,
                          delta: {},
                          finish_reason: value.finishReason === "abort" ? "length" : "stop",
                        },
                      ],
                    };
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
                    controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
                  } else if (value.type === "error") {
                    const chunk = {
                      id: "chatcmpl-cursor",
                      object: "chat.completion.chunk",
                      created: Math.floor(Date.now() / 1000),
                      model: reqBody.model,
                      choices: [
                        {
                          index: 0,
                          delta: { content: `\n\n[Cursor Error: ${value.error?.message || "Unknown error"}]\n` },
                          finish_reason: "stop",
                        },
                      ],
                    };
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
                    controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
                  }
                }
              } catch (err) {
                controller.error(err);
              } finally {
                try {
                  controller.close();
                } catch (e) {}
                reader.releaseLock();
              }
            },
            cancel() {
              stream.cancel();
            }
          });

          return new Response(byteStream, {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
            },
          });
          } catch (err) {
            console.error(">>> AUTH FETCH ERROR:", err);
            if (err instanceof Error && err.stack) {
              console.error(err.stack);
            }
            throw err;
          }
        },
      };
    },
  };
}
