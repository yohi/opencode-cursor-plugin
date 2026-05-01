import type { Plugin, PluginInput, Hooks } from "@opencode-ai/plugin";
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

interface ExtendedPluginInput extends PluginInput {
  app?: {
    log: {
      error(message: string, data?: unknown): void;
      warn(message: string, data?: unknown): void;
      debug(message: string, data?: unknown): void;
      info(message: string, data?: unknown): void;
    };
  };
}

const CustomToolsPlugin: Plugin = async (input: PluginInput): Promise<Hooks> => {
  const extendedInput = input as ExtendedPluginInput;
  const log = extendedInput.app?.log;

  // loadDotenv をプラグイン実行時に呼び出す
  if (process.env.NODE_ENV !== "test") {
    loadDotenv();
  }

  return {
    tool: {
      cursor_prompt: {
        description: `Cursor エージェントへ任意のプロンプトを送信し、応答テキストを取得します。引数 prompt は必須、model はオプション（未指定時は DEFAULT_LOCAL_MODEL "${DEFAULT_LOCAL_MODEL}" を使用）。`,
        args: args,
        async execute(args: CursorPromptArgs) {
          const rawLog = (input as ExtendedPluginInput).app?.log;
          const log = {
            error: (m: string, d?: unknown) => rawLog?.error(m, d),
            warn: (m: string, d?: unknown) => rawLog?.warn(m, d),
            debug: (m: string, d?: unknown) => rawLog?.debug(m, d),
            info: (m: string, d?: unknown) => rawLog?.info(m, d),
          };

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

          const { Agent } = await import("@cursor/sdk");
          const agent = await Agent.create({
            apiKey,
            model: { id: resolvedModelId },
            local: { cwd: process.cwd() },
          });

          try {
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

            throw new Error(`cursor_prompt: unexpected run status ${result.status}`);
          } finally {
            await agent.close();
            log.info("cursor_prompt: agent closed");
          }
        },
      },
    },
  } as unknown as Hooks;
};

export default CustomToolsPlugin;
