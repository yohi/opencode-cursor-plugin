import type { AuthHook, ProviderHookContext } from "@opencode-ai/plugin";

export async function resolveApiKey(ctx: ProviderHookContext): Promise<string | undefined> {
  try {
    const fromContext = await (ctx.auth as any)?.get?.("cursor");
    if (fromContext?.type === "api") {
      const key = typeof fromContext.key === "string" ? fromContext.key.trim() : "";
      if (key) return key;
    }
  } catch {
    // fall through to env lookup
  }

  const fromEnv = process.env.CURSOR_API_KEY?.trim();
  return fromEnv ? fromEnv : undefined;
}

export const cursorAuthHook: AuthHook = {
  provider: "cursor",
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
