import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  clearAttempts as clearMemoryAttempts,
  isRateLimited as isMemoryRateLimited,
  recordFailure as recordMemoryFailure,
  type RateLimitOptions,
  type RateLimitStatus,
} from "@/lib/rate-limit";

/**
 * Persistent store for multi-instance login + `/t` throttles.
 * Unit tests / explicit memory driver keep the in-process map.
 */
const shouldUseMemoryStore = (): boolean => {
  if (process.env.RATE_LIMIT_DRIVER === "memory") return true;
  if (process.env.RATE_LIMIT_DRIVER === "postgres") return false;
  // Production (compose / PaaS) shares Postgres; local + unit tests stay in-memory.
  return process.env.NODE_ENV !== "production";
};

/**
 * Peek whether `key` is currently over its failure budget.
 */
export async function isRateLimitedAsync(
  key: string,
  options: RateLimitOptions,
): Promise<RateLimitStatus> {
  if (shouldUseMemoryStore()) return isMemoryRateLimited(key, options);

  const rows = await db.execute<{
    failure_count: number;
    reset_at: Date | string;
  }>(
    sql`
      select failure_count, reset_at
      from rate_limit_buckets
      where key = ${key}
      limit 1
    `,
  );
  const row = rows[0];
  if (!row) return { limited: false, retryAfterMs: 0 };

  const resetAtMs = new Date(row.reset_at).getTime();
  const now = Date.now();
  if (now >= resetAtMs) return { limited: false, retryAfterMs: 0 };
  if (row.failure_count >= options.limit) {
    return { limited: true, retryAfterMs: resetAtMs - now };
  }
  return { limited: false, retryAfterMs: 0 };
}

/**
 * Record one failed attempt in the shared store.
 */
export async function recordFailureAsync(
  key: string,
  options: RateLimitOptions,
): Promise<void> {
  if (shouldUseMemoryStore()) {
    recordMemoryFailure(key, options);
    return;
  }

  const windowSeconds = Math.max(1, Math.ceil(options.windowMs / 1000));
  await db.execute(sql`
    insert into rate_limit_buckets (key, failure_count, reset_at)
    values (
      ${key},
      1,
      now() + (${windowSeconds}::text || ' seconds')::interval
    )
    on conflict (key) do update set
      failure_count = case
        when rate_limit_buckets.reset_at <= now() then 1
        else rate_limit_buckets.failure_count + 1
      end,
      reset_at = case
        when rate_limit_buckets.reset_at <= now()
          then now() + (${windowSeconds}::text || ' seconds')::interval
        else rate_limit_buckets.reset_at
      end
  `);
}

/**
 * Clear a key's failures after a successful attempt.
 */
export async function clearAttemptsAsync(key: string): Promise<void> {
  if (shouldUseMemoryStore()) {
    clearMemoryAttempts(key);
    return;
  }
  await db.execute(sql`delete from rate_limit_buckets where key = ${key}`);
}
