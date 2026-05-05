export interface FallbackModel {
  id: string;
  name: string;
  contextWindow: number;
}

export const DEFAULT_MODEL_ID = "composer-2";

export const STATIC_FALLBACK_MODELS: ReadonlyArray<FallbackModel> = [
  { id: "composer-2", name: "Composer 2", contextWindow: 200_000 },
  { id: "claude-3-7-sonnet", name: "Claude 3.7 Sonnet (via Cursor)", contextWindow: 200_000 },
  { id: "gpt-4o", name: "GPT-4o (via Cursor)", contextWindow: 128_000 },
];

export interface ModelMeta {
  specificationVersion: "v2";
  provider: "cursor-provider";
  modelId: string;
  name: string;
  contextWindow: number;
}

export function makeModelMeta(model: FallbackModel): ModelMeta {
  return {
    specificationVersion: "v2",
    provider: "cursor-provider",
    modelId: model.id,
    name: model.name,
    contextWindow: model.contextWindow,
  };
}
