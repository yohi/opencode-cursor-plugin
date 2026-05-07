import type { AuthHook, ProviderHookContext } from "@opencode-ai/plugin";

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

export const cursorAuthHook: AuthHook = {
  provider: "cursor",
  async loader(getAuth) {
    const auth = await getAuth();
    const key = typeof (auth as any)?.key === "string" ? (auth as any).key.trim() : "";
    return { apiKey: key || process.env.CURSOR_API_KEY || "cursor" };
  },
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
};
