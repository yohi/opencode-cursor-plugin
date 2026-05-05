import type { Logger } from "./logger.js";

export type RetryPhase = "create" | "pre-stream" | "in-stream" | "post-stream";

export interface RetryDecision {
  retry: boolean;
  delayMs: number;
  reason: string;
}

function noRetry(reason: string): RetryDecision {
  return { retry: false, delayMs: 0, reason };
}

export function classifyError(err: any, ctx: { phase: RetryPhase }): RetryDecision {
  // Cursor SDK のクラスを直接 instanceof でチェックするとインポート時の副作用で落ちるため、
  // エラーのプロパティや .name で判別する。
  const errorName = err?.constructor?.name || err?.name;

  if (errorName === "NetworkError" || err?.isRetryable === true) {
    if (ctx.phase === "create" || ctx.phase === "pre-stream") {
      return { retry: true, delayMs: 500, reason: "NetworkError safe to retry pre-delivery" };
    }
    return noRetry("NetworkError after delivery would duplicate stream");
  }

  if (errorName === "AuthenticationError") return noRetry("AuthenticationError");
  if (errorName === "ConfigurationError") return noRetry("ConfigurationError");
  if (errorName === "RateLimitError") {
    return { retry: true, delayMs: 2000, reason: "RateLimitError with backoff" };
  }

  if (errorName === "IntegrationNotConnectedError") return noRetry("IntegrationNotConnectedError");
  if (errorName === "UnknownAgentError") return noRetry("UnknownAgentError handled by caller");
  if (errorName === "CursorSdkError") return noRetry("CursorSdkError");

  return noRetry("unknown");
}

export function logError(log: Logger, err: any, context: Record<string, unknown>): void {
  const errorType = err?.constructor?.name || err?.name || typeof err;
  const messageLength = err instanceof Error ? err.message.length : 0;

  const allowedKeys = ["phase", "requestId", "status", "userId", "model"];
  const safeContext = Object.fromEntries(
    Object.entries(context).filter(([key]) => allowedKeys.includes(key))
  );

  log.error("cursor-provider: error captured", {
    ...safeContext,
    errorType,
    messageLength,
  });
}
