export interface FallbackModel {
  id: string;
  name: string;
  contextWindow: number;
  status?: string;
  releaseDate?: string;
  capabilities?: Partial<ModelMeta["capabilities"]>;
}

export const DEFAULT_MODEL_ID = "composer-2";

export const STATIC_FALLBACK_MODELS: ReadonlyArray<FallbackModel> = [
  { id: "composer-2", name: "Composer 2", contextWindow: 200_000, releaseDate: "2026-03-15", capabilities: { reasoning: true } },
  { id: "claude-4-6-sonnet", name: "Claude 4.6 Sonnet", contextWindow: 200_000, releaseDate: "2026-01-20", capabilities: { input: { text: true, audio: false, image: true, video: false, pdf: true } } },
  { id: "claude-4-7-opus", name: "Claude 4.7 Opus", contextWindow: 200_000, releaseDate: "2026-04-10", capabilities: { reasoning: true, input: { text: true, audio: false, image: true, video: false, pdf: true } } },
  { id: "claude-4-5-sonnet", name: "Claude 4.5 Sonnet", contextWindow: 200_000, releaseDate: "2025-10-15" },
  { id: "claude-4-sonnet", name: "Claude 4 Sonnet", contextWindow: 200_000, releaseDate: "2025-06-20" },
  { id: "claude-4-sonnet-1m", name: "Claude 4 Sonnet 1M", contextWindow: 1_000_000, releaseDate: "2025-08-15" },
  { id: "claude-4-5-haiku", name: "Claude 4.5 Haiku", contextWindow: 200_000, releaseDate: "2025-11-01" },
  { id: "gpt-5.5", name: "GPT-5.5", contextWindow: 128_000, releaseDate: "2026-05-01", capabilities: { reasoning: true } },
  { id: "gpt-5.4", name: "GPT-5.4", contextWindow: 128_000, releaseDate: "2026-03-01" },
  { id: "gpt-5.2-codex", name: "GPT-5.2 Codex", contextWindow: 400_000, releaseDate: "2026-01-15" },
  { id: "gpt-5", name: "GPT-5", contextWindow: 200_000, releaseDate: "2025-11-15", capabilities: { reasoning: true } },
  { id: "gemini-3.1-pro", name: "Gemini 3.1 Pro", contextWindow: 2_000_000, releaseDate: "2026-04-20", capabilities: { input: { text: true, audio: true, image: true, video: true, pdf: true } } },
  { id: "gemini-3-flash", name: "Gemini 3 Flash", contextWindow: 1_000_000, releaseDate: "2026-02-15" },
  { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", contextWindow: 1_000_000, releaseDate: "2025-05-10" },
  { id: "kimi-k2.5", name: "Kimi K2.5", contextWindow: 128_000, releaseDate: "2026-03-01" },
  { id: "grok-4.3", name: "Grok 4.3", contextWindow: 200_000, releaseDate: "2026-04-15" },
  { id: "o3-mini", name: "o3-mini", contextWindow: 200_000, releaseDate: "2025-12-05", capabilities: { reasoning: true } },
  { id: "claude-3-7-sonnet", name: "Claude 3.7 Sonnet", contextWindow: 200_000, releaseDate: "2025-02-24" },
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
  const allowedStatuses = ["alpha", "beta", "deprecated"] as const;
  type AllowedStatus = (typeof allowedStatuses)[number];

  const isAllowedStatus = (status?: string): status is AllowedStatus =>
    !!status && (allowedStatuses as readonly string[]).includes(status);

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
      reasoning: model.capabilities?.reasoning ?? false,
      attachment: false,
      toolcall: false,
      input: {
        text: true,
        audio: false,
        image: false,
        video: false,
        pdf: false,
        ...model.capabilities?.input,
      },
      output: {
        text: true,
        audio: false,
        image: false,
        video: false,
        pdf: false,
        ...model.capabilities?.output,
      },
      interleaved: false,
      ...model.capabilities,
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
    ...(isAllowedStatus(model.status) ? { status: model.status } : {}),
    options: {},
    headers: {},
    release_date: model.releaseDate ?? "2026-01-01",
  };
}
