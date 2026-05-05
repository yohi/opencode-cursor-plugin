export async function resolveApiKey(ctx: any): Promise<string | undefined> {
  try {
    const fromContext = await ctx.auth?.get?.("cursor-provider");
    if (fromContext?.type === "api") {
      const key = typeof fromContext.key === "string" ? fromContext.key.trim() : "";
      if (key) return key;
    }
  } catch (err) {
  }

  const fromEnv = process.env.CURSOR_API_KEY?.trim();
  return fromEnv ? fromEnv : undefined;
}

export const cursorAuthHook: any = {
  provider: "cursor-provider",
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
