import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadDotenv();

const DEFAULT_LOCAL_MODEL = "composer-2";

const argsSchema = z.object({
  prompt: z
    .string()
    .min(1)
    .describe("Cursor エージェントへ送信するユーザープロンプト本文"),
  model: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Cursor 側で利用するモデル識別子（例: 'composer-2'）。未指定の場合は SDK のデフォルトを使用",
    ),
});

type Logger = {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

type CursorPromptArgs = z.infer<typeof argsSchema>;

type CursorPromptTool = {
  description: string;
  args: typeof argsSchema;
  execute: (args: CursorPromptArgs) => Promise<string>;
};

type PluginResult = {
  tool: {
    cursor_prompt: CursorPromptTool;
  };
};

function defineTool(definition: CursorPromptTool): CursorPromptTool {
  return definition;
}

const CustomToolsPlugin = async ({
  client,
}: {
  client: { app: { log: Logger } };
}): Promise<PluginResult> => {
  const log = client.app.log;

  return {
    tool: {
      cursor_prompt: defineTool({
        description:
          "Cursor エージェントへ任意のプロンプトを送信し、応答テキストを取得します。引数 prompt は必須、model はオプション（未指定時は Cursor SDK のデフォルトモデルを使用）。",
        args: argsSchema,
        async execute(args) {
          const apiKey = process.env.CURSOR_API_KEY;
          if (!apiKey) {
            log.error("CURSOR_API_KEY is not set; cursor_prompt cannot run");
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

          try {
            const agent = await Agent.create({
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
              log.error("cursor_prompt: run was cancelled", {
                runId: result.id,
                status: result.status,
              });
              throw new Error(`Cursor run was cancelled (id=${result.id})`);
            }

            log.error("cursor_prompt: unexpected run status", {
              runId: result.id,
              status: result.status,
            });
            throw new Error(`Cursor run finished with unexpected status (id=${result.id})`);
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
          }
        },
      }),
    },
  };
};

export default CustomToolsPlugin;
