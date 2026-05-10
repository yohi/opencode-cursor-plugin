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

export function getErrorName(err: unknown): string {
  if (err instanceof Error) {
    // Prefer name if it's set to something more specific than "Error"
    if (err.name && err.name !== "Error") return err.name;
    // Fallback to structural properties or constructor name
    return (err as any).code || (err as any).protoErrorCode || err.constructor.name;
  }
  return String(err);
}

/**
 * Classifies an error to decide whether to retry.
 * We use property-based checks to avoid static imports from @cursor/sdk,
 * which can cause crashes in some runtimes (like Bun) during early loading.
 */
export function classifyError(err: unknown, ctx: { phase: RetryPhase }): RetryDecision {
  const errorName = getErrorName(err);

  if (errorName === "NetworkError") {
    // We consider any NetworkError retryable in early phases (pre-delivery).
    if (ctx.phase === "create" || ctx.phase === "pre-stream") {
      return { retry: true, delayMs: 500, reason: "NetworkError safe to retry pre-delivery" };
    }

    // In later phases, we NEVER retry to avoid duplicating stream parts, 
    // even if the SDK marks it as retryable.
    return noRetry("NetworkError after delivery would duplicate stream");
  }

  if (errorName === "AuthenticationError") return noRetry("AuthenticationError");
  if (errorName === "ConfigurationError") return noRetry("ConfigurationError");
  if (errorName === "RateLimitError") {
    // Mirror the same phase check applied to "NetworkError"
    if (ctx.phase === "create" || ctx.phase === "pre-stream") {
      return { retry: true, delayMs: 2000, reason: "RateLimitError with backoff" };
    }
    return noRetry("RateLimitError after delivery would duplicate stream");
  }

  if (errorName === "IntegrationNotConnectedError") return noRetry("IntegrationNotConnectedError");
  if (errorName === "UnknownAgentError") return noRetry("UnknownAgentError handled by caller");
  if (errorName === "CursorSdkError" || errorName.endsWith("SdkError")) return noRetry("CursorSdkError");

  return noRetry("unknown");
}

export function logError(log: Logger, err: unknown, context: Record<string, unknown>): void {
  const errorType = err instanceof Error ? getErrorName(err) : typeof err;
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
