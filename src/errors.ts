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
  const msgLower = errorMessage.toLowerCase();

  const isRateLimit = errorName === "RateLimitError" || 
                     errorName === "ResourceExhausted" || 
                     msgLower.includes("rate limit");

  const isNetwork = errorName === "NetworkError" || 
                    errorName === "ConnectError" || 
                    errorName === "Unavailable" || 
                    errorName === "DeadlineExceeded" ||
                    msgLower.includes("network error") ||
                    msgLower.includes("timeout") ||
                    msgLower.includes("timed out");

  const isPreDelivery = ctx.phase === "create" || ctx.phase === "pre-stream";

  if (isNetwork) {
    return isPreDelivery 
      ? { retry: true, delayMs: 1000, reason: "NetworkError safe to retry pre-delivery" }
      : noRetry("NetworkError after delivery would duplicate stream");
  }

  if (isRateLimit) {
    return isPreDelivery
      ? { retry: true, delayMs: 2000, reason: "RateLimitError with backoff" }
      : noRetry("RateLimitError after delivery would duplicate stream");
  }

  // Handle specific non-retryable errors
  const errorMap: Record<string, string> = {
    AuthenticationError: "AuthenticationError",
    IntegrationNotConnectedError: "IntegrationNotConnectedError",
    UnknownAgentError: "UnknownAgentError handled by caller",
    CursorSdkError: "CursorSdkError",
  };

  const mapped = Object.prototype.hasOwnProperty.call(errorMap, errorName)
    ? errorMap[errorName]
    : undefined;
  if (mapped !== undefined) return noRetry(mapped);
  if (errorName.endsWith("SdkError")) return noRetry("CursorSdkError");

  if (errorName === "ConfigurationError") {
    if (msgLower.includes("repository_required") || msgLower.includes("repository is required")) {
      return noRetry(`ConfigurationError: ${CONFIG_ERROR_MESSAGES.REPOSITORY_REQUIRED}`);
    }
    if (msgLower.includes("failed to verify existence of branch")) {
      return noRetry(`ConfigurationError: ${CONFIG_ERROR_MESSAGES.BRANCH_VERIFICATION_FAILED}`);
    }
    return noRetry("ConfigurationError");
  }

  return noRetry("unknown");
}

export const CONFIG_ERROR_MESSAGES = {
  REPOSITORY_REQUIRED: "Repository is required. Set CURSOR_REPO_URL or ensure git remote is configured.",
  BRANCH_VERIFICATION_FAILED: "Branch verification failed. Please ensure your GitHub account is connected at https://cursor.com/settings and has access to the repository. (Note: Bitbucket/GitLab may not be fully supported by Cursor's cloud agents; consider using a dummy GitHub URL as a workaround)",
} as const;

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
