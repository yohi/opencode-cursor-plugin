import { createProviderHook } from "./.opencode/plugins/cursor-provider/provider";
import { createLogger } from "./.opencode/plugins/cursor-provider/logger";

const log = createLogger(console);
const hook = createProviderHook({ resolveApiKey: async () => "dummy", log });

async function main() {
  const models = await hook.models?.({}, {} as any);
  console.log("Returned models:", Object.keys(models || {}));
}

main().catch(console.error);
