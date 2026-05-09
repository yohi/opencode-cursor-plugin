export interface FallbackModel {
  id: string;
  name: string;
  contextWindow: number;
}

export const DEFAULT_MODEL_ID = "composer-2";

export const STATIC_FALLBACK_MODELS: ReadonlyArray<FallbackModel> = [
  { id: "composer-2", name: "Composer 2", contextWindow: 200_000 },
  { id: "claude-sonnet-4-6", name: "Sonnet 4.6", contextWindow: 200_000 },
  { id: "claude-3-7-sonnet", name: "Claude 3.7 Sonnet", contextWindow: 200_000 },
  { id: "gpt-5.5", name: "GPT-5.5", contextWindow: 128_000 },
  { id: "gpt-5.4", name: "GPT-5.4", contextWindow: 128_000 },
  { id: "gpt-4o", name: "GPT-4o", contextWindow: 128_000 },
  { id: "claude-opus-4-7", name: "Opus 4.7", contextWindow: 200_000 },
  { id: "claude-opus-4-6", name: "Opus 4.6", contextWindow: 200_000 },
  { id: "claude-opus-4-5", name: "Opus 4.5", contextWindow: 200_000 },
  { id: "claude-haiku-4-5", name: "Haiku 4.5", contextWindow: 200_000 },
  { id: "gemini-3.1-pro", name: "Gemini 3.1 Pro", contextWindow: 1_000_000 },
  { id: "gemini-3-flash", name: "Gemini 3 Flash", contextWindow: 1_000_000 },
  { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", contextWindow: 1_000_000 },
  { id: "kimi-k2.5", name: "Kimi K2.5", contextWindow: 128_000 },
  { id: "grok-4.3", name: "Grok 4.3", contextWindow: 200_000 },
  { id: "gpt-5.3-codex", name: "Codex 5.3", contextWindow: 400_000 },
  { id: "gpt-5.2", name: "GPT-5.2", contextWindow: 400_000 },
  { id: "gpt-5.2-codex", name: "Codex 5.2", contextWindow: 400_000 },
  { id: "gpt-5.4-mini", name: "GPT-5.4 Mini", contextWindow: 128_000 },
  { id: "gpt-5.4-nano", name: "GPT-5.4 Nano", contextWindow: 128_000 },
  { id: "gpt-5-mini", name: "GPT-5 Mini", contextWindow: 128_000 },
  { id: "gpt-5.1", name: "GPT-5.1", contextWindow: 128_000 },
  { id: "gpt-5.3-codex-spark", name: "Codex 5.3 Spark", contextWindow: 128_000 },
  { id: "gpt-5.1-codex-max", name: "Codex 5.1 Max", contextWindow: 128_000 },
  { id: "gpt-5.1-codex-mini", name: "Codex 5.1 Mini", contextWindow: 128_000 },
  { id: "claude-sonnet-4", name: "Sonnet 4", contextWindow: 200_000 },
];

export interface ModelMeta {
  id: string;
  providerID: "cursor";
  api: {
    id: "cursor";
    url: string;
    npm: string;
  };
  name: string;
  capabilities: {
    temperature: boolean;
    reasoning: boolean;
    attachment: boolean;
    toolcall: boolean;
    input: {
      text: boolean;
      audio: boolean;
      image: boolean;
      video: boolean;
      pdf: boolean;
    };
    output: {
      text: boolean;
      audio: boolean;
      image: boolean;
      video: boolean;
      pdf: boolean;
    };
    interleaved: boolean;
  };
  cost: {
    input: number;
    output: number;
    cache: {
      read: number;
      write: number;
    };
  };
  limit: {
    context: number;
    output: number;
  };
  status?: "alpha" | "beta" | "deprecated";
  options: Record<string, unknown>;
  headers: Record<string, string>;
  release_date: string;
}

export function makeModelMeta(model: FallbackModel): ModelMeta {
  return {
    id: model.id,
    providerID: "cursor",
    api: {
      id: "cursor",
      url: "",
      npm: "",
    },
    name: model.name,
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: false,
      toolcall: false,
      input: {
        text: true,
        audio: false,
        image: false,
        video: false,
        pdf: false,
      },
      output: {
        text: true,
        audio: false,
        image: false,
        video: false,
        pdf: false,
      },
      interleaved: false,
    },
    cost: {
      input: 0,
      output: 0,
      cache: {
        read: 0,
        write: 0,
      },
    },
    limit: {
      context: model.contextWindow,
      output: 16_384,
    },
    options: {},
    headers: {},
    release_date: "2024-01-01",
  };
}
