import {
  AuthenticationError,
  ConfigurationError,
  CursorSdkError,
  IntegrationNotConnectedError,
  NetworkError,
  RateLimitError,
  UnknownAgentError,
} from "@cursor/sdk";
import type { Logger } from "./logger";

export type RetryPhase = "create" | "pre-stream" | "in-stream" | "post-stream";

export interface RetryDecision {
  retry: boolean;
  delayMs: number;
  reason: string;
}

function noRetry(reason: string): RetryDecision {
  return { retry: false, delayMs: 0, reason };
}


export function classifyError(err: unknown, ctx: { phase: RetryPhase }): RetryDecision {
  if (err instanceof NetworkError) {
    // We consider any NetworkError retryable in early phases (pre-delivery).
    // In later phases, we only retry if explicitly marked as retryable by the SDK.
    if (ctx.phase === "create" || ctx.phase === "pre-stream") {
      return { retry: true, delayMs: 500, reason: "NetworkError safe to retry pre-delivery" };
    }

    if ((err as any).isRetryable === true) {
      return { retry: true, delayMs: 500, reason: "NetworkError explicitly marked as retryable" };
    }

    return noRetry("NetworkError after delivery would duplicate stream");
  }

  if (err instanceof AuthenticationError) return noRetry("AuthenticationError");
  if (err instanceof ConfigurationError) return noRetry("ConfigurationError");
  if (err instanceof RateLimitError) {
    return { retry: true, delayMs: 2000, reason: "RateLimitError with backoff" };
  }

  if (err instanceof IntegrationNotConnectedError) return noRetry("IntegrationNotConnectedError");
  if (err instanceof UnknownAgentError) return noRetry("UnknownAgentError handled by caller");
  if (err instanceof CursorSdkError) return noRetry("CursorSdkError");

  return noRetry("unknown");
}

export function logError(log: Logger, err: unknown, context: Record<string, unknown>): void {
  const errorType =
    err instanceof AuthenticationError ? "AuthenticationError"
      : err instanceof ConfigurationError ? "ConfigurationError"
        : err instanceof RateLimitError ? "RateLimitError"
          : err instanceof NetworkError ? "NetworkError"
            : err instanceof IntegrationNotConnectedError ? "IntegrationNotConnectedError"
              : err instanceof UnknownAgentError ? "UnknownAgentError"
                : err instanceof CursorSdkError ? "CursorSdkError"
                  : err instanceof Error ? err.constructor.name
                    : typeof err;
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
