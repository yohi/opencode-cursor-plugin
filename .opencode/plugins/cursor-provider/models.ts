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
  status: "active";
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
    status: "active",
    options: {},
    headers: {},
    release_date: "2024-01-01",
  };
}
