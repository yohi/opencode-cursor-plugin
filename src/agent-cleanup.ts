import type { SDKAgent } from "@cursor/sdk";
import type { Logger } from "./logger.js";

export const DISPOSE_TIMEOUT_MS = 5_000;
export const RETRY_DELAY_MS = 200;

/**
 * タイムアウト付きで [Symbol.asyncDispose]() を呼び出す。
 * タイムアウト後に遅延して reject された場合の UnhandledPromiseRejection を抑制する。
 */
async function callAsyncDispose(agent: SDKAgent, log: Logger): Promise<"ok" | "timeout"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const timeoutPromise = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      resolve("timeout");
    }, DISPOSE_TIMEOUT_MS);
  });
  try {
    // Symbol.asyncDispose はブラケット記法必須 (言語仕様)。
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

/**
 * Agent を安全に解放する。
 * タイムアウト時はネイティブロックのリスクを考慮してリトライせず、
 * 例外 reject 時のみ 1 度だけリトライを行う。
 */
export async function disposeAgentSafely(agent: SDKAgent, log: Logger): Promise<void> {
  try {
    const result = await callAsyncDispose(agent, log);
    if (result === "timeout") {
      // NOTE: タイムアウト時はネイティブ側 (sqlite3 など) がロック保持・close 進行中の可能性が
      // 高く、再度 [Symbol.asyncDispose]() を呼ぶと二重解放 / use-after-free を誘発しうる。
      // よってリトライせず、警告ログのみで握り潰す (プロセスは継続)。
      log.warn("cursor-provider: agent dispose timed out; not retrying (native lock risk)", {
        timeoutMs: DISPOSE_TIMEOUT_MS,
      });
      return;
    }
  } catch (err) {
    // 例外 reject の場合は dispose 呼び出しが確定的に決着しているため、
    // RETRY_DELAY_MS 待機後に 1 度だけ再試行する。
    log.warn("cursor-provider: agent dispose failed; retrying once", {
      errorType: err instanceof Error ? err.constructor.name : typeof err,
    });
    try {
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      const retryResult = await callAsyncDispose(agent, log);
      if (retryResult === "timeout") {
        log.warn("cursor-provider: agent dispose retry timed out; native lock remains a risk", {
          timeoutMs: DISPOSE_TIMEOUT_MS,
        });
      }
    } catch (retryErr) {
      log.warn("cursor-provider: agent dispose retry failed; suppressing to prevent process crash", {
        errorType: retryErr instanceof Error ? retryErr.constructor.name : typeof retryErr,
      });
    }
  }
}
