export const DISPOSE_TIMEOUT_MS = 5_000;

export async function disposeAgentSafely(agent: any, log: any): Promise<void> {
  if (!agent) return;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), DISPOSE_TIMEOUT_MS);
  });

  try {
    let disposePromise: Promise<any>;
    
    if (typeof agent.close === "function") {
      disposePromise = agent.close();
    } else if (typeof agent[Symbol.asyncDispose] === "function") {
      disposePromise = agent[Symbol.asyncDispose]();
    } else {
      return;
    }

    disposePromise = disposePromise.then(() => "ok" as const);
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
