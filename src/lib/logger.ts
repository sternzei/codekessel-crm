// Minimal structured logger seam. Replace transport (e.g. pino) at deploy
// time. Rule: NEVER log PII — IDs, statuses, template keys only.
type LogFields = Record<string, string | number | boolean | null | undefined>;

function line(level: string, msg: string, fields?: LogFields): void {
  const payload = fields ? ` ${JSON.stringify(fields)}` : "";
  console.log(`[${new Date().toISOString()}] ${level} ${msg}${payload}`);
}

export const logger = {
  info: (msg: string, fields?: LogFields) => line("INFO", msg, fields),
  warn: (msg: string, fields?: LogFields) => line("WARN", msg, fields),
  error: (msg: string, fields?: LogFields) => line("ERROR", msg, fields),
};
