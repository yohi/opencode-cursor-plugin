import { tool, type Plugin, type Hooks, type PluginInput } from "@opencode-ai/plugin";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";

export const promptSchema = z
  .string()
  .trim()
  .min(1)
  .describe("Cursor エージェントへ送信するユーザープロンプト本文");

const DEFAULT_LOCAL_MODEL = "composer-2";

export const modelSchema = z
  .string()
  .trim()
  .min(1)
  .optional()
  .describe(
    `Cursor 側で利用するモデル識別子（例: 'composer-2'）。未指定の場合は DEFAULT_LOCAL_MODEL ("${DEFAULT_LOCAL_MODEL}") を使用`,
  );

const args = {
  prompt: promptSchema,
  model: modelSchema,
};

type CursorPromptArgs = z.infer<z.ZodObject<typeof args>>;

// OpenCode v3 の PluginInput には app.log が直接存在しない可能性があるため、
// テストと実際のランタイムの両方で動作するように、明示的な型定義とラッパーを使用します。
interface AppLog {
  error(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
}

const CustomToolsPlugin: Plugin = async (input: PluginInput): Promise<Hooks> => {
  // PluginInput (v3) の引数は { client } ですが、テストコードは PluginInput そのものを context として渡しています。
  // また、テストは context.app.log を期待しています。
  // ここでは両方のパターンに対応できるようにします。
  const anyInput = input as any;
  const rawLog = anyInput.client?.app?.log ?? anyInput.app?.log;

  const log: AppLog = {
    error: (m, d) => (typeof rawLog?.error === "function" ? rawLog.error(m, d) : console.error(m, d)),
    warn: (m, d) => (typeof rawLog?.warn === "function" ? rawLog.warn(m, d) : console.warn(m, d)),
    debug: (m, d) => (typeof rawLog?.debug === "function" ? rawLog.debug(m, d) : console.debug(m, d)),
    info: (m, d) => (typeof rawLog?.info === "function" ? rawLog.info(m, d) : console.info(m, d)),
  };

  // loadDotenv をプラグイン実行時に呼び出す
  if (process.env.NODE_ENV !== "test") {
    loadDotenv();
  }

  return {
    tool: {
      cursor_prompt: tool({
        description: `Cursor エージェントへ任意のプロンプトを送信し、応答テキストを取得します。引数 prompt は必須、model はオプション（未指定時は DEFAULT_LOCAL_MODEL "${DEFAULT_LOCAL_MODEL}" を使用）。`,
        args: args,
        async execute(args: CursorPromptArgs) {
          const apiKey = process.env.CURSOR_API_KEY;
          if (apiKey == null || apiKey.trim() === "") {
            log.error("CURSOR_API_KEY is not set or blank; cursor_prompt cannot run", { apiKey });
            throw new Error("CURSOR_API_KEY is not set in the environment");
          }

          const resolvedModelId = args.model ?? DEFAULT_LOCAL_MODEL;
          if (!args.model) {
            log.warn("cursor_prompt: model omitted; substituting DEFAULT_LOCAL_MODEL", {
              defaultModelId: DEFAULT_LOCAL_MODEL,
            });
          }

          log.debug("cursor_prompt invoked", {
            promptLength: args.prompt.length,
            modelId: resolvedModelId,
          });

          const sdk = await import("@cursor/sdk");
          const { Agent, CursorAgentError, NetworkError } = sdk;

          let agent: Awaited<ReturnType<typeof Agent.create>> | undefined;
          try {
            agent = await Agent.create({
              apiKey,
              model: { id: resolvedModelId },
              local: { cwd: process.cwd() },
            });
            log.info("cursor_prompt: agent created");

            const run = await agent.send(args.prompt);
            log.info("cursor_prompt: prompt sent");
            const result = await run.wait();

            if (result.status === "finished") {
              const responseText = result.result ?? "";
              log.info("cursor_prompt: run finished", {
                responseLength: responseText.length,
              });
              return responseText;
            }

            if (result.status === "error") {
              const errInfo = (result as { error?: { code?: string; message?: string } }).error;
              log.error("cursor_prompt: run finished with status=error", {
                runId: result.id,
                status: result.status,
                errorCode: errInfo?.code,
                errorMessageLength: errInfo?.message?.length,
              });
              throw new Error(`Cursor run finished with status=error (id=${result.id})`);
            }

            if (result.status === "cancelled") {
              log.warn("cursor_prompt: run was cancelled", {
                runId: result.id,
                status: result.status,
              });
              throw new Error(`Cursor run was cancelled (id=${result.id})`);
            }

            log.error("cursor_prompt: unexpected run status", {
              runId: result.id,
              status: result.status,
            });
            throw new Error(`Cursor run finished with unexpected status (id=${result.id}, status=${result.status})`);
          } catch (err) {
            if (err instanceof NetworkError) {
              log.error("cursor_prompt: NetworkError", {
                message: err.message,
                isRetryable: err.isRetryable,
              });
              throw err;
            }
            if (err instanceof CursorAgentError) {
              log.error("cursor_prompt: CursorAgentError", {
                kind: err.constructor.name,
                message: err.message,
              });
              throw err;
            }
            throw err;
          } finally {
            if (agent) {
              try {
                await agent.close();
                log.info("cursor_prompt: agent closed");
              } catch (closeErr) {
                log.warn("cursor_prompt: agent.close failed", {
                  message: closeErr instanceof Error ? closeErr.message : String(closeErr),
                });
              }
            }
          }
        },
      }),
    },
  };
};

export default CustomToolsPlugin;
