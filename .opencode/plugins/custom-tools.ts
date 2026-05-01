import { Plugin, PluginContext } from "@opencode-ai/plugin";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";

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

type CursorPromptArgs = z.infer<typeof argsSchema>;

const CustomToolsPlugin: Plugin = async ({
  app,
}: PluginContext): Promise<ReturnType<Plugin>> => {
  const log = app.log;

  // loadDotenv をプラグイン実行時に呼び出す
  if (process.env.NODE_ENV !== "test") {
    loadDotenv();
  }

  return {
    tool: {
      cursor_prompt: {
        description:
          "Cursor エージェントへ任意のプロンプトを送信し、応答テキストを取得します。引数 prompt は必須、model はオプション（未指定時は Cursor SDK のデフォルトモデルを使用）。",
        args: argsSchema,
        async execute(args: CursorPromptArgs) {
          const apiKey = process.env.CURSOR_API_KEY;
          if (apiKey == null || apiKey.trim() === "") {
            log.error("CURSOR_API_KEY is not set or blank; cursor_prompt cannot run", { apiKey });
            throw new Error("CURSOR_API_KEY is not set in the environment");
          }

          throw new Error("not implemented yet");
        },
      },
    },
  } satisfies ReturnType<Plugin>;
};

export default CustomToolsPlugin;
