/**
 * ISO 8601 date string in YYYY-MM-DD format.
 */
export type ISODateString = `${number}-${number}-${number}`;

export interface FallbackModel {
  id: string;
  name: string;
  contextWindow: number;
  status?: string;
  releaseDate?: ISODateString;
  capabilities?: Partial<ModelMeta["capabilities"]>;
}

export const DEFAULT_MODEL_ID = "composer-2";

const CLAUDE_CAPABILITIES = {
  reasoning: true,
  toolcall: true,
  input: { text: true, audio: false, image: true, video: false, pdf: true },
};

const GPT5_CAPABILITIES = {
  reasoning: true,
  toolcall: true,
  input: { text: true, audio: false, image: true, video: false, pdf: false },
};

/**
 * Validates if a string is a valid ISO 8601 date (YYYY-MM-DD) and represents a real calendar date.
 */
export function assertISODateString(date: string): ISODateString {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) {
    throw new Error(`Invalid ISO date format: ${date}. Expected YYYY-MM-DD.`);
  }

  const [, yearStr, monthStr, dayStr] = match;
  if (!yearStr || !monthStr || !dayStr) {
    throw new Error(`Invalid ISO date format: ${date}. Expected YYYY-MM-DD.`);
  }

  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);

  const d = new Date(Date.UTC(year, month - 1, day));
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    throw new Error(`Invalid calendar date: ${date}.`);
  }

  return date as ISODateString;
}

export const STATIC_FALLBACK_MODELS: ReadonlyArray<FallbackModel> = [
  { id: "composer-2", name: "Composer 2", contextWindow: 200_000, releaseDate: "2026-03-15", capabilities: { reasoning: true, toolcall: true } },
  { id: "claude-sonnet-4-6", name: "Claude 4.6 Sonnet", contextWindow: 200_000, releaseDate: "2026-01-20", capabilities: CLAUDE_CAPABILITIES },
  { id: "claude-opus-4-7", name: "Claude 4.7 Opus", contextWindow: 200_000, releaseDate: "2026-04-10", capabilities: CLAUDE_CAPABILITIES },
  { id: "claude-haiku-4-5", name: "Claude 4.5 Haiku", contextWindow: 200_000, releaseDate: "2025-11-01", capabilities: CLAUDE_CAPABILITIES },
  { id: "claude-sonnet-4-5", name: "Claude 4.5 Sonnet", contextWindow: 200_000, releaseDate: "2025-10-15", capabilities: CLAUDE_CAPABILITIES },
  { id: "claude-sonnet-4", name: "Claude 4 Sonnet", contextWindow: 200_000, releaseDate: "2025-06-20", capabilities: CLAUDE_CAPABILITIES },
  { id: "claude-opus-4-6", name: "Claude 4.6 Opus", contextWindow: 200_000, releaseDate: "2026-01-20", capabilities: CLAUDE_CAPABILITIES },
  { id: "claude-opus-4-5", name: "Claude 4.5 Opus", contextWindow: 200_000, releaseDate: "2025-10-15", capabilities: CLAUDE_CAPABILITIES },
  { id: "gpt-5.5", name: "GPT-5.5", contextWindow: 128_000, releaseDate: "2026-05-01", capabilities: GPT5_CAPABILITIES },
  { id: "gpt-5.4", name: "GPT-5.4", contextWindow: 128_000, releaseDate: "2026-03-01", capabilities: GPT5_CAPABILITIES },
  { id: "gpt-5.4-mini", name: "GPT-5.4 Mini", contextWindow: 128_000, releaseDate: "2026-03-01", capabilities: GPT5_CAPABILITIES },
  { id: "gpt-5.4-nano", name: "GPT-5.4 Nano", contextWindow: 128_000, releaseDate: "2026-03-01", capabilities: GPT5_CAPABILITIES },
  { id: "gpt-5.3-codex", name: "GPT-5.3 Codex", contextWindow: 400_000, releaseDate: "2026-01-15", capabilities: GPT5_CAPABILITIES },
  { id: "gpt-5.3-codex-spark", name: "GPT-5.3 Codex Spark", contextWindow: 400_000, releaseDate: "2026-01-15", capabilities: GPT5_CAPABILITIES },
  { id: "gpt-5.2-codex", name: "GPT-5.2 Codex", contextWindow: 400_000, releaseDate: "2026-01-15", capabilities: GPT5_CAPABILITIES },
  { id: "gpt-5.2", name: "GPT-5.2", contextWindow: 128_000, releaseDate: "2025-12-01", capabilities: GPT5_CAPABILITIES },
  { id: "gpt-5.1-codex-max", name: "GPT-5.1 Codex Max", contextWindow: 400_000, releaseDate: "2025-11-01", capabilities: GPT5_CAPABILITIES },
  { id: "gpt-5.1-codex-mini", name: "GPT-5.1 Codex Mini", contextWindow: 200_000, releaseDate: "2025-11-01", capabilities: GPT5_CAPABILITIES },
  { id: "gpt-5.1", name: "GPT-5.1", contextWindow: 128_000, releaseDate: "2025-11-01", capabilities: GPT5_CAPABILITIES },
  { id: "gpt-5-mini", name: "GPT-5 Mini", contextWindow: 128_000, releaseDate: "2025-11-01", capabilities: GPT5_CAPABILITIES },
  { id: "gemini-3.1-pro", name: "Gemini 3.1 Pro", contextWindow: 2_000_000, releaseDate: "2026-04-20", capabilities: { input: { text: true, audio: true, image: true, video: true, pdf: true }, toolcall: true } },
  { id: "gemini-3-flash", name: "Gemini 3 Flash", contextWindow: 1_000_000, releaseDate: "2026-02-15", capabilities: { toolcall: true } },
  { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", contextWindow: 1_000_000, releaseDate: "2025-05-10", capabilities: { toolcall: true } },
  { id: "kimi-k2.5", name: "Kimi K2.5", contextWindow: 128_000, releaseDate: "2026-03-01", capabilities: { toolcall: true } },
  { id: "grok-4.3", name: "Grok 4.3", contextWindow: 200_000, releaseDate: "2026-04-15", capabilities: { toolcall: true } },
  { id: "default", name: "Default", contextWindow: 200_000, releaseDate: "2026-01-01", capabilities: { toolcall: true } },
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
  release_date: ISODateString;
}

export function makeModelMeta(model: FallbackModel): ModelMeta {
  const allowedStatuses = ["alpha", "beta", "deprecated"] as const;
  type AllowedStatus = (typeof allowedStatuses)[number];

  const isAllowedStatus = (status?: string): status is AllowedStatus =>
    !!status && (allowedStatuses as readonly string[]).includes(status);

  const input = {
    text: true,
    audio: false,
    image: false,
    video: false,
    pdf: false,
    ...model.capabilities?.input,
  };

  const output = {
    text: true,
    audio: false,
    image: false,
    video: false,
    pdf: false,
    ...model.capabilities?.output,
  };

  // Ensure releaseDate is valid at conversion time
  const releaseDate = model.releaseDate
    ? assertISODateString(model.releaseDate)
    : assertISODateString("2026-01-01");

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
      attachment: model.capabilities?.attachment ?? (input.image || input.pdf),
      toolcall: model.capabilities?.toolcall ?? false,
      interleaved: model.capabilities?.interleaved ?? false,
      input,
      output,
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
    release_date: releaseDate,
  };
}
