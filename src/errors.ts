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
  if (typeof err === "object" && err !== null) {
    const e = err as {
      name?: string;
      code?: string | number;
      protoErrorCode?: string | number;
      constructor?: { name?: string };
    };

    if (e.name && e.name !== "Error") return e.name;
    if (e.code) return String(e.code);
    if (e.protoErrorCode) return String(e.protoErrorCode);
    if (e.constructor?.name && e.constructor.name !== "Object") return e.constructor.name;
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
  const errorMessage = err instanceof Error ? err.message : String(err);
  const isRateLimit = errorName === "RateLimitError" || 
                     errorName === "ResourceExhausted" || 
                     errorMessage.toLowerCase().includes("rate limit");

  const isNetwork = errorName === "NetworkError" || 
                    errorName === "ConnectError" || 
                    errorName === "Unavailable" || 
                    errorName === "DeadlineExceeded" ||
                    errorMessage.toLowerCase().includes("network error") ||
                    errorMessage.toLowerCase().includes("timeout") ||
                    errorMessage.toLowerCase().includes("timed out");

  if (isNetwork) {
    // We consider any NetworkError retryable in early phases (pre-delivery).
    if (ctx.phase === "create" || ctx.phase === "pre-stream") {
      return { retry: true, delayMs: 1000, reason: "NetworkError safe to retry pre-delivery" };
    }

    // In later phases, we NEVER retry to avoid duplicating stream parts, 
    // even if the SDK marks it as retryable.
    return noRetry("NetworkError after delivery would duplicate stream");
  }

  if (isRateLimit) {
    // Mirror the same phase check applied to "NetworkError"
    if (ctx.phase === "create" || ctx.phase === "pre-stream") {
      return { retry: true, delayMs: 2000, reason: "RateLimitError with backoff" };
    }
    return noRetry("RateLimitError after delivery would duplicate stream");
  }

  if (errorName === "AuthenticationError") return noRetry("AuthenticationError");
  if (errorName === "ConfigurationError") {
    if (errorMessage.includes("repository_required") || errorMessage.includes("Repository is required")) {
      return noRetry("ConfigurationError: Repository is required. Set CURSOR_REPO_URL or ensure git remote is configured.");
    }
    if (errorMessage.includes("Failed to verify existence of branch")) {
      return noRetry("ConfigurationError: Branch verification failed. Please ensure your GitHub account is connected at https://cursor.com/settings and has access to the repository. (Note: Bitbucket/GitLab may not be fully supported by Cursor's cloud agents; consider using a dummy GitHub URL as a workaround)");
    }
    return noRetry("ConfigurationError");
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
