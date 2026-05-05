/**
 * OpenCode Cursor Provider Plugin - Package Name ID version
 */

export default async function(ctx: any) {
  const id = "cursor-provider";
  console.log(`[${id}] plugin initialization`);

  const provider = {
    id,
    async models() {
      console.log(`[${id}] models() requested`);
      const { STATIC_FALLBACK_MODELS, makeModelMeta } = await import("./models.js");
      const result: Record<string, any> = {};
      for (const m of STATIC_FALLBACK_MODELS) {
        result[m.id] = {
          ...makeModelMeta(m as any),
          provider: id,
          async doStream(args: any) {
             const { createProviderHook } = await import("./provider.js");
             const { resolveApiKey } = await import("./auth.js");
             const { createLogger } = await import("./logger.js");
             const { createAgentPool } = await import("./agent-pool.js");
             const log = createLogger(console);
             const pool = createAgentPool({ log });
             const hook = createProviderHook({ resolveApiKey, log, pool });
             const mm = await hook.models({}, {} as any);
             return mm[m.id].doStream(args);
          }
        };
      }
      return result;
    }
  };

  const auth = {
    provider: id,
    methods: [{ type: "api", label: "Cursor Key", prompts: [{ key: "key", message: "Key", type: "text" }] }],
  };

  return {
    name: id,
    auth,
    provider,
  };
}
