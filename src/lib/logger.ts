import "server-only";

type Level = "info" | "warn" | "error";

/** Keys whose values must never reach logs. */
const REDACTED_KEYS = /pass(word)?|token|secret|authorization|cookie|hash/i;

function redact(value: unknown, depth = 0): unknown {
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (depth > 3 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, REDACTED_KEYS.test(key) ? "[redacted]" : redact(item, depth + 1)]),
  );
}

function write(level: Level, message: string, context?: Record<string, unknown>) {
  if (process.env.NODE_ENV === "test") return;
  const line = { level, time: new Date().toISOString(), message, ...(context ? { context: redact(context) } : {}) };
  const out = JSON.stringify(line);
  if (level === "error") console.error(out);
  else if (level === "warn") console.warn(out);
  else console.info(out);
}

export const logger = {
  info: (message: string, context?: Record<string, unknown>) => write("info", message, context),
  warn: (message: string, context?: Record<string, unknown>) => write("warn", message, context),
  error: (message: string, context?: Record<string, unknown>) => write("error", message, context),
};
