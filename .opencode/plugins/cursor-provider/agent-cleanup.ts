import type { SDKAgent } from "@cursor/sdk";
import type { Logger } from "./logger";

export const DISPOSE_TIMEOUT_MS = 5_000;

export async function disposeAgentSafely(agent: SDKAgent, log: Logger): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), DISPOSE_TIMEOUT_MS);
  });

  try {
    // Symbol.asyncDispose は言語仕様上ブラケット記法が必須であり、動的なキーアクセスではないため、Codacy/ESLint のセキュリティ警告を無視します。
    // eslint-disable-next-line security/detect-object-injection
    // skip-codacy
    const disposePromise = agent[Symbol.asyncDispose]().then(() => "ok" as const);
    // タイムアウト後に dispose が遅延 reject した場合の UnhandledPromiseRejection を抑制する
    disposePromise.catch(() => {});
    const result = await Promise.race([disposePromise, timeoutPromise]);

    if (result === "timeout") {
      log.warn("cursor-provider: agent dispose timed out", { timeoutMs: DISPOSE_TIMEOUT_MS });
    }
  } catch (err) {
    log.warn("cursor-provider: agent dispose failed", {
      errorType: err instanceof Error ? err.constructor.name : typeof err,
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
}
