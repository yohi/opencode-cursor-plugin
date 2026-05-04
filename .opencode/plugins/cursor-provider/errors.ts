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

const noRetry = (reason: string): RetryDecision => ({ retry: false, delayMs: 0, reason });

export function classifyError(err: unknown, ctx: { phase: RetryPhase }): RetryDecision {
  if (err instanceof NetworkError) {
    if (!err.isRetryable) {
      return noRetry("NetworkError not retryable");
    }

    if (ctx.phase === "create" || ctx.phase === "pre-stream") {
      return { retry: true, delayMs: 500, reason: "NetworkError safe to retry pre-delivery" };
    }

    return noRetry("NetworkError after delivery would duplicate stream");
  }

  if (err instanceof AuthenticationError) return noRetry("AuthenticationError");
  if (err instanceof ConfigurationError) return noRetry("ConfigurationError");
  if (err instanceof RateLimitError) return noRetry("RateLimitError");
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

  log.error("cursor-provider: error captured", {
    ...context,
    errorType,
    messageLength,
  });
}
