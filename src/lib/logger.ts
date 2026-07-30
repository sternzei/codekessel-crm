// Structured logging seam. One JSON object per line so any collector (Loki,
// CloudWatch, Datadog, `docker logs | jq`) can parse it without a regex.
// Rule: NEVER log PII — IDs, statuses, template keys only.
//
// Errors additionally go to ERROR_WEBHOOK_URL when configured, so a thrown
// server action in production does not vanish into stdout. The payload shape is
// deliberately generic (Sentry, Slack via a relay, or any HTTP sink).

type LogFields = Record<string, string | number | boolean | null | undefined>;

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const configuredLevel = (): LogLevel => {
  const raw = process.env.LOG_LEVEL?.toLowerCase();
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") {
    return raw;
  }
  return "info";
};

const ERROR_WEBHOOK_TIMEOUT_MS = 5_000;

const emit = (level: LogLevel, msg: string, fields?: LogFields): void => {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[configuredLevel()]) return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    ...fields,
  });
  if (level === "error") {
    console.error(line);
    return;
  }
  console.log(line);
};

/**
 * Ships an error to the configured sink. Fire-and-forget: a failing monitoring
 * endpoint must never take a request down with it.
 */
const forwardError = (msg: string, fields?: LogFields): void => {
  const url = process.env.ERROR_WEBHOOK_URL;
  if (!url) return;
  void fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      service: "qcg-antragsplattform",
      environment: process.env.NODE_ENV ?? "development",
      level: "error",
      message: msg,
      ...fields,
    }),
    signal: AbortSignal.timeout(ERROR_WEBHOOK_TIMEOUT_MS),
  }).catch(() => {
    // Swallowed on purpose: reporting a reporting failure would loop.
  });
};

export const logger = {
  debug: (msg: string, fields?: LogFields) => emit("debug", msg, fields),
  info: (msg: string, fields?: LogFields) => emit("info", msg, fields),
  warn: (msg: string, fields?: LogFields) => emit("warn", msg, fields),
  error: (msg: string, fields?: LogFields) => {
    emit("error", msg, fields);
    forwardError(msg, fields);
  },
};

/**
 * Logs a caught exception with its type, message and stack. `fields` carries
 * correlation data only — never participant data. Pass Next.js' `digest` when
 * you have one so a support ticket maps onto a log line.
 */
export const captureException = (
  error: unknown,
  msg: string,
  fields?: LogFields,
): void => {
  const normalized =
    error instanceof Error
      ? { errorName: error.name, errorMessage: error.message, stack: error.stack }
      : { errorName: "unknown", errorMessage: String(error), stack: undefined };
  logger.error(msg, { ...fields, ...normalized });
};
