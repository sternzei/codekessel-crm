import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Cross-instance failure buckets for login + anonymous `/t/*` throttles.
 * Global (no tenant_id): login happens before tenant context exists.
 * Accessed without RLS — see migration 0016.
 */
export const rateLimitBuckets = pgTable("rate_limit_buckets", {
  key: text("key").primaryKey(),
  failureCount: integer("failure_count").notNull().default(0),
  resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
});
