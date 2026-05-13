import type { SDKAgent } from "@cursor/sdk";
import { setTimeout as sleep } from "node:timers/promises";
import type { Logger } from "./logger.js";

export const DISPOSE_TIMEOUT_MS = 5_000;
export const RETRY_DELAY_MS = 200;

async function disposeWithTimeout(agent: SDKAgent, log: Logger): Promise<"ok" | "timeout"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const timeoutPromise = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      resolve("timeout");
    }, DISPOSE_TIMEOUT_MS);
  });

  try {
    // Symbol.asyncDispose は言語仕様上ブラケット記法が必須であり、動的なキーアクセスではないため、Codacy/ESLint のセキュリティ警告を無視します。
    // eslint-disable-next-line security/detect-object-injection
    // skip-codacy
    const disposePromise = agent[Symbol.asyncDispose]().then(() => "ok" as const);
    // タイムアウト後に dispose が遅延 reject した場合の UnhandledPromiseRejection を抑制する
    disposePromise.catch((lateErr) => {
      if (timedOut) {
        log.debug("cursor-provider: late reject after timeout while disposing agent", {
          errorType: lateErr instanceof Error ? lateErr.constructor.name : typeof lateErr,
        });
      }
    });
    return await Promise.race([disposePromise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function disposeAgentSafely(
  agent: SDKAgent,
  log: Logger,
  // テストでのモックを容易にするために sleep 関数を注入可能にする
  _sleep = sleep
): Promise<void> {
  try {
    const result = await disposeWithTimeout(agent, log);
    if (result === "timeout") {
      log.warn("cursor-provider: agent dispose timed out", { timeoutMs: DISPOSE_TIMEOUT_MS });
      return;
    }
  } catch (err) {
    log.warn("cursor-provider: agent dispose failed", {
      errorType: err instanceof Error ? err.constructor.name : typeof err,
    });

    await _sleep(RETRY_DELAY_MS);

    try {
      const retryResult = await disposeWithTimeout(agent, log);
      if (retryResult === "timeout") {
        log.warn("cursor-provider: retry dispose timed out", {
          timeoutMs: DISPOSE_TIMEOUT_MS,
          retryDelayMs: RETRY_DELAY_MS,
        });
      }
    } catch (retryErr) {
      log.warn("cursor-provider: retry dispose failed", {
        errorType: retryErr instanceof Error ? retryErr.constructor.name : typeof retryErr,
        retryDelayMs: RETRY_DELAY_MS,
      });
    }
  }
}
