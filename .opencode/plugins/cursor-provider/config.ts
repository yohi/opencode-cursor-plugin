import type { Config } from "@opencode-ai/plugin";
import { STATIC_FALLBACK_MODELS } from "./models";

const CURSOR_PROVIDER_ID = "cursor";

export function ensureCursorProviderConfig(config: Config, options: { baseURL?: string } = {}): void {
  config.provider ??= {};
  
  // enabled_providers が定義されている場合は、自分自身を追加して有効化されるようにする
  if (config.enabled_providers && Array.isArray(config.enabled_providers)) {
    if (!config.enabled_providers.includes(CURSOR_PROVIDER_ID)) {
      config.enabled_providers.push(CURSOR_PROVIDER_ID);
    }
  }

  const current = config.provider[CURSOR_PROVIDER_ID] ?? {};
  const currentOptions = current.options ?? {};
  const currentModels = current.models ?? {};
  const fallbackModels = Object.fromEntries(
    STATIC_FALLBACK_MODELS.map((model) => [
      model.id,
      {
        name: model.name,
        limit: {
          context: model.contextWindow,
          output: 16_384,
        },
      },
    ]),
  );

  config.provider[CURSOR_PROVIDER_ID] = {
    ...current,
    id: CURSOR_PROVIDER_ID,
    name: current.name ?? "Cursor",
    npm: current.npm ?? "@ai-sdk/openai-compatible",
    options: {
      ...currentOptions,
      ...(currentOptions.baseURL ? {} : { baseURL: options.baseURL ?? "http://127.0.0.1:32125/v1" }),
    },
    models: {
      // プロバイダーとして認識させるための最低限の定義
      // 詳細は ProviderHook.models() で動的に上書き・追加される
      "composer-2": { name: "Composer 2 (initializing...)" },
      ...currentModels,
    },
  };
}
