export interface Logger {
  info(message: string, extra?: Record<string, unknown>): void;
  warn(message: string, extra?: Record<string, unknown>): void;
  error(message: string, extra?: Record<string, unknown>): void;
  debug(message: string, extra?: Record<string, unknown>): void;
}

type Level = "info" | "warn" | "error" | "debug";

interface RawLogMethods {
  info?: (message: string, extra?: Record<string, unknown>) => void;
  warn?: (message: string, extra?: Record<string, unknown>) => void;
  error?: (message: string, extra?: Record<string, unknown>) => void;
  debug?: (message: string, extra?: Record<string, unknown>) => void;
}

type RawLogFn = (payload: {
  body: { service: string; level: Level; message: string; extra?: Record<string, unknown> };
}) => void;

export function createLogger(rawLog: RawLogMethods | RawLogFn, service = "cursor-provider"): Logger {
  const dispatch = (level: Level, message: string, extra?: Record<string, unknown>) => {
    const method = rawLog as RawLogMethods;
    const fn = method[level];
    if (typeof fn === "function") {
      fn(message, extra);
      return;
    }

    if (typeof rawLog === "function") {
      rawLog({
        body: { service, level, message, extra },
      });
    }
  };

  return {
    info: (message, extra) => dispatch("info", message, extra),
    warn: (message, extra) => dispatch("warn", message, extra),
    error: (message, extra) => dispatch("error", message, extra),
    debug: (message, extra) => dispatch("debug", message, extra),
  };
}
