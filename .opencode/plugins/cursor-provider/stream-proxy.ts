const toolWarning = (name: string) =>
  `⚠️ [cursor-provider] Cursor agent attempted to use tool: ${name}. Pure LLM mode is in effect; the tool call is surfaced for visibility but not executed by OpenCode.`;

export function createStream(input: any): {
  stream: ReadableStream<any>;
  done: Promise<any>;
} {
  const { agent: initialAgent, message, log, abortSignal, recreateAgent } = input;
  let agent = initialAgent;
  let hasClosedStream = false;
  let hasEmittedDelta = false;
  let finishReason: string | null = null;
  let lastErrorType: string | undefined;
  let controller!: ReadableStreamDefaultController<any>;
  const warnedToolCallIds = new Set<string>();
  const internalAbort = new AbortController();
  const onExternalAbort = () => internalAbort.abort();

  abortSignal?.addEventListener("abort", onExternalAbort);
  if (abortSignal?.aborted) {
    internalAbort.abort();
  }

  const setFinishReason = (reason: string) => {
    if (finishReason === null) finishReason = reason;
  };

  const captureErrorType = (err: unknown) => {
    const name = (err as any)?.constructor?.name || (err as any)?.name || "Error";
    lastErrorType = name;
  };

  const safeEnqueue = (part: any) => {
    if (hasClosedStream) {
      log.debug("stream-proxy: enqueue after close ignored", { partType: part.type });
      return;
    }

    if (part.type === "text-delta" || part.type === "reasoning-delta") {
      hasEmittedDelta = true;
    }
    if (part.type === "finish") {
      setFinishReason(part.finishReason);
    }
    if (part.type === "error") {
      setFinishReason("error");
    }

    controller.enqueue(part);
  };

  const safeClose = () => {
    if (hasClosedStream) return;
    hasClosedStream = true;
    controller.close();
  };

  const onDelta = (update: any) => {
    switch (update.type) {
      case "text-delta":
        safeEnqueue({ type: "text-delta", text: update.text });
        break;
      case "thinking-delta":
        safeEnqueue({ type: "reasoning-delta", text: update.text });
        break;
      case "tool-call-started": {
        const id = update.toolCallId ?? update.toolName;
        if (warnedToolCallIds.has(id)) break;
        warnedToolCallIds.add(id);
        log.warn("cursor: unexpected tool-call in Pure LLM mode", {
          toolName: update.toolName,
          toolCallId: update.toolCallId,
        });
        safeEnqueue({ type: "text-delta", text: toolWarning(update.toolName ?? "unknown") });
        break;
      }
      case "tool-call-partial":
      case "tool-call-completed":
        log.debug("stream-proxy: drop tool-call detail", { type: update.type });
        break;
      case "turn-ended":
        safeEnqueue({ type: "finish", finishReason: "stop" });
        safeClose();
        break;
      default:
        log.debug("stream-proxy: unknown update", { type: update.type });
    }
  };

  const handleRunStatus = (result: { status: string }) => {
    if (result.status === "finished") {
      safeEnqueue({ type: "finish", finishReason: "stop" });
      safeClose();
      return;
    }
    if (result.status === "cancelled") {
      log.warn("stream-proxy: run cancelled");
      safeEnqueue({ type: "finish", finishReason: "abort" });
      safeClose();
      return;
    }

    log.error("stream-proxy: run.status non-finished", { status: result.status });
    safeEnqueue({ type: "error", error: { message: `cursor: status=${result.status}` } });
    safeClose();
  };

  let resolveDone!: (value: any) => void;
  const done = new Promise<any>((resolve) => {
    resolveDone = resolve;
  });

  const stream = new ReadableStream<any>({
    start(createdController) {
      controller = createdController;
      const onAbort = () => {
        log.warn("stream-proxy: abort signal received");
        setFinishReason("abort");
        safeEnqueue({ type: "finish", finishReason: "abort" });
        safeClose();
      };

      internalAbort.signal.addEventListener("abort", onAbort);

      void (async () => {
        const { classifyError, logError } = await import("./errors.js");

        if (internalAbort.signal.aborted) {
          internalAbort.signal.removeEventListener("abort", onAbort);
          abortSignal?.removeEventListener("abort", onExternalAbort);
          setFinishReason("abort");
          safeEnqueue({ type: "finish", finishReason: "abort" });
          safeClose();
          resolveDone({ finishReason: finishReason ?? "abort" });
          return;
        }

        try {
          const run = await agent.send(message, { onDelta });
          const result = await (run as any).wait();
          handleRunStatus(result);
        } catch (err: any) {
          const phase = hasEmittedDelta ? "in-stream" : "pre-stream";
          const errName = err?.constructor?.name || err?.name || "Error";

          if (phase === "pre-stream" && errName === "UnknownAgentError" && recreateAgent && !internalAbort.signal.aborted) {
            log.warn("stream-proxy: UnknownAgentError; retrying with new agent");
            let recreated: { agent: any; message: string };
            try {
              recreated = await recreateAgent();
              agent = recreated.agent;
            } catch (retryErr: any) {
              captureErrorType(retryErr);
              logError(log, retryErr, { phase: "create", retry: false });
              safeEnqueue({ type: "error", error: { message: retryErr?.message || String(retryErr) } });
              safeClose();
              return;
            }

            if (internalAbort.signal.aborted) {
              safeEnqueue({ type: "finish", finishReason: "abort" });
              safeClose();
              return;
            }

            try {
              const rerun = await agent.send(recreated.message, { onDelta });
              const result = await (rerun as any).wait();
              handleRunStatus(result);
            } catch (retryErr: any) {
              captureErrorType(retryErr);
              logError(log, retryErr, { phase: "pre-stream", retry: false });
              safeEnqueue({ type: "error", error: { message: retryErr?.message || String(retryErr) } });
              safeClose();
            }
            return;
          }

          const decision = classifyError(err, { phase });
          logError(log, err, { phase, retry: decision.retry });
          if (!decision.retry) {
            captureErrorType(err);
            safeEnqueue({ type: "error", error: { message: err?.message || String(err) } });
            safeClose();
          } else {
            await new Promise((resolve) => setTimeout(resolve, decision.delayMs));
            if (internalAbort.signal.aborted) {
              safeEnqueue({ type: "finish", finishReason: "abort" });
              safeClose();
            } else {
              try {
                const rerun = await agent.send(message, { onDelta });
                const result = await (rerun as any).wait();
                handleRunStatus(result);
              } catch (retryErr: any) {
                captureErrorType(retryErr);
                safeEnqueue({ type: "error", error: { message: retryErr?.message || String(retryErr) } });
                safeClose();
              }
            }
          }
        } finally {
          internalAbort.signal.removeEventListener("abort", onAbort);
          abortSignal?.removeEventListener("abort", onExternalAbort);
          const resolvedReason = finishReason ?? "abort";
          resolveDone(
            resolvedReason === "error" && lastErrorType
              ? { finishReason: resolvedReason, errorType: lastErrorType }
              : { finishReason: resolvedReason },
          );
        }
      })();
    },
    cancel() {
      hasClosedStream = true;
      setFinishReason("abort");
      internalAbort.abort();
    },
  });

  return { stream, done };
}
