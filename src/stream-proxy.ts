import type { SDKAgent } from "@cursor/sdk";
import type { Logger } from "./logger.js";
import { classifyError, logError, getErrorName } from "./errors.js";

export interface StreamProxyInput {
  agent: SDKAgent;
  message: string;
  log: Logger;
  abortSignal?: AbortSignal;
  recreateAgent?: () => Promise<{ agent: SDKAgent; message: string }>;
}

const toolWarning = (name: string) =>
  `⚠️ [cursor-provider] Cursor agent attempted to use tool: ${name}. Pure LLM mode is in effect; the tool call is surfaced for visibility but not executed by OpenCode.`;

export type StreamFinishReason = "stop" | "abort" | "error";

export type StreamErrorType =
  | "UnknownAgentError"
  | "NetworkError"
  | "AuthenticationError"
  | "RateLimitError"
  | "ConfigurationError"
  | "IntegrationNotConnectedError"
  | "CursorSdkError"
  | "Error";

export function createStream(input: StreamProxyInput): {
  stream: ReadableStream<unknown>;
  done: Promise<{ finishReason: StreamFinishReason; errorType?: StreamErrorType }>;
} {
  const { agent: initialAgent, message, log, abortSignal, recreateAgent } = input;
  let agent = initialAgent;
  let hasClosedStream = false;
  let hasEmittedDelta = false;
  let finishReason: StreamFinishReason | null = null;
  let lastErrorType: StreamErrorType | undefined;
  let controller!: ReadableStreamDefaultController<unknown>;
  const warnedToolCallIds = new Set<string>();
  const internalAbort = new AbortController();
  const onExternalAbort = () => internalAbort.abort();

  abortSignal?.addEventListener("abort", onExternalAbort);
  if (abortSignal?.aborted) {
    internalAbort.abort();
  }

  const setFinishReason = (reason: StreamFinishReason) => {
    if (finishReason === null) finishReason = reason;
  };

  const captureErrorType = (err: unknown) => {
    const rawName = getErrorName(err);
    const validTypes: StreamErrorType[] = [
      "UnknownAgentError",
      "NetworkError",
      "AuthenticationError",
      "RateLimitError",
      "ConfigurationError",
      "IntegrationNotConnectedError",
      "CursorSdkError",
    ];

    lastErrorType = (validTypes.includes(rawName as StreamErrorType) ? rawName : "Error") as StreamErrorType;
  };

  const safeEnqueue = (part: { type: string; [key: string]: unknown }) => {
    if (hasClosedStream) {
      log.debug("stream-proxy: enqueue after close ignored", { partType: part.type });
      return;
    }

    if (part.type === "text-delta" || part.type === "reasoning-delta") {
      hasEmittedDelta = true;
    }
    if (part.type === "finish") {
      setFinishReason(part.finishReason as StreamFinishReason);
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

  const onDelta = ({ update }: { update: { type: string; text?: string; toolCallId?: string; toolName?: string } }) => {
    switch (update.type) {
      case "text-delta":
        safeEnqueue({ type: "text-delta", text: update.text ?? "" });
        break;
      case "thinking-delta":
        safeEnqueue({ type: "reasoning-delta", text: update.text ?? "" });
        break;
      case "tool-call-started": {
        const id = (update.toolCallId as string | undefined) ?? (update.toolName as string | undefined) ?? "unknown";
        if (warnedToolCallIds.has(id)) break;
        warnedToolCallIds.add(id);
        log.warn("cursor: unexpected tool-call in Pure LLM mode", {
          toolName: update.toolName,
          toolCallId: update.toolCallId,
        });
        safeEnqueue({ type: "text-delta", text: toolWarning((update.toolName as string | undefined) ?? "unknown") });
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

  let resolveDone!: (value: { finishReason: StreamFinishReason; errorType?: StreamErrorType }) => void;
  const done = new Promise<{ finishReason: StreamFinishReason; errorType?: StreamErrorType }>((resolve) => {
    resolveDone = resolve;
  });

  const stream = new ReadableStream<unknown>({
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
        try {
          if (internalAbort.signal.aborted) {
            setFinishReason("abort");
            safeEnqueue({ type: "finish", finishReason: "abort" });
            safeClose();
            return;
          }

          try {
            // @cursor/sdk@1.0.10 の SendOptions には signal がないため、abort は
            // この proxy 側で downstream を閉じて伝播させる。
            const run = await agent.send(message, { onDelta });
            const result = await (run as { wait: () => Promise<{ status: string }> }).wait();
            handleRunStatus(result);
          } catch (err) {
            const phase = hasEmittedDelta ? "in-stream" : "pre-stream";
            const errName = getErrorName(err);

            if (phase === "pre-stream" && errName === "UnknownAgentError" && recreateAgent && !internalAbort.signal.aborted) {
              log.warn("stream-proxy: UnknownAgentError; retrying with new agent");
              let recreated: { agent: SDKAgent; message: string };
              try {
                recreated = await recreateAgent();
                agent = recreated.agent;
              } catch (retryErr) {
                captureErrorType(retryErr);
                logError(log, retryErr, { phase: "create", retry: false });
                safeEnqueue({ type: "error", error: { message: retryErr instanceof Error ? retryErr.message : String(retryErr) } });
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
                const result = await (rerun as { wait: () => Promise<{ status: string }> }).wait();
                handleRunStatus(result);
              } catch (retryErr) {
                captureErrorType(retryErr);
                logError(log, retryErr, { phase: "pre-stream", retry: false });
                safeEnqueue({ type: "error", error: { message: retryErr instanceof Error ? retryErr.message : String(retryErr) } });
                safeClose();
              }
              return;
            }

            const decision = classifyError(err, { phase });
            logError(log, err, { phase, retry: decision.retry });
            
            const maxRetries = 3;
            let attempt = 1; // 最初の失敗を1回目とする
            let currentErr = err;

            while (attempt < maxRetries && !internalAbort.signal.aborted) {
              const retryDecision = classifyError(currentErr, { phase });
              if (!retryDecision.retry) break;

              const backoffDelay = retryDecision.delayMs * Math.pow(2, attempt - 1);
              
              log.info(`stream-proxy: retrying (attempt ${attempt + 1}/${maxRetries}) in ${backoffDelay}ms...`);
              await new Promise((resolve) => setTimeout(resolve, backoffDelay));
              
              if (internalAbort.signal.aborted) break;

              try {
                const rerun = await agent.send(message, { onDelta });
                const result = await (rerun as { wait: () => Promise<{ status: string }> }).wait();
                handleRunStatus(result);
                return; // 成功
              } catch (retryErr) {
                currentErr = retryErr;
                attempt++;
                logError(log, retryErr, { phase, retry: attempt < maxRetries });
              }
            }

            if (!internalAbort.signal.aborted) {
              captureErrorType(currentErr);
              safeEnqueue({ type: "error", error: { message: currentErr instanceof Error ? currentErr.message : String(currentErr) } });
              safeClose();
            }
          }
        } catch (unexpectedErr) {
          log.error("stream-proxy: unexpected error in async IIFE", { 
            error: unexpectedErr instanceof Error ? unexpectedErr.message : String(unexpectedErr) 
          });
          if (!internalAbort.signal.aborted) {
            safeEnqueue({ type: "error", error: { message: "Unexpected internal error" } });
            safeClose();
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
