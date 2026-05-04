import { createHash } from "node:crypto";

export type PromptPart = { type: "text"; text: string } | { type: string; [key: string]: unknown };

export type PromptMessage =
  | { role: "system"; content: string | PromptPart[] }
  | { role: "user" | "assistant" | "tool"; content: string | PromptPart[] };

export type LanguageModelV2Prompt = PromptMessage[];

export interface TranslatedRequest {
  prefixHash: string;
  latestUserMessage: string;
  fullPromptOnMiss: string;
  nextHash: string;
}

function extractText(message: PromptMessage): string {
  if (typeof message.content === "string") {
    return message.content;
  }

  return message.content.map((part) => (part.type === "text" ? part.text : "")).join("");
}

function hashMessages(messages: PromptMessage[]): string {
  const hash = createHash("sha256");

  for (const message of messages) {
    if (message.role !== "system" && message.role !== "user") {
      continue;
    }

    hash.update(`${message.role}\u0000${extractText(message)}\u0001`);
  }

  return hash.digest("hex");
}

export function translate(prompt: LanguageModelV2Prompt): TranslatedRequest {
  if (prompt.length === 0) {
    throw new Error("translate: prompt is empty");
  }

  const last = prompt[prompt.length - 1];
  if (!last || last.role !== "user") {
    throw new Error("translate: last message must be user");
  }

  const latestUserMessage = extractText(last);
  const prefixHash = hashMessages(prompt.slice(0, -1));
  const nextHash = hashMessages(prompt);
  const fullPromptOnMiss = prompt.map((message) => `<${message.role}>${extractText(message)}</${message.role}>`).join("\n");

  return {
    prefixHash,
    latestUserMessage,
    fullPromptOnMiss,
    nextHash,
  };
}
