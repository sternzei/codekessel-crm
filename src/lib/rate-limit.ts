// Minimal failed-attempt throttle. In-memory map is the unit-test / single-
// process default. Production login + `/t` paths use the Postgres-backed
// async helpers in `rate-limit-store.ts` so multi-instance deploys share a
// budget. No Redis by design (web/hooks.md: no remote one-off packages).
//
// Design: only *failures* count toward the limit, and a success clears the
// bucket. Legitimate users are never throttled; an attacker guessing
// passwords accumulates failures until locked out for the window.

export interface RateLimitOptions {
  /** Max allowed failures within the window before blocking. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export interface RateLimitStatus {
  limited: boolean;
  /** Milliseconds until the window resets (0 when not limited). */
  retryAfterMs: number;
}

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/** Opportunistic sweep so the map cannot grow without bound. */
function prune(now: number): void {
  if (buckets.size < 1000) return;
  for (const [key, bucket] of buckets) {
    if (now >= bucket.resetAt) buckets.delete(key);
  }
}

/** Peek: is this key currently over its failure budget? Does not mutate. */
export function isRateLimited(
  key: string,
  options: RateLimitOptions,
): RateLimitStatus {
  const now = Date.now();
  prune(now);
  const bucket = buckets.get(key);
  if (!bucket || now >= bucket.resetAt) return { limited: false, retryAfterMs: 0 };
  if (bucket.count >= options.limit) {
    return { limited: true, retryAfterMs: bucket.resetAt - now };
  }
  return { limited: false, retryAfterMs: 0 };
}

/** Record one failed attempt, opening a fresh window if needed. */
export function recordFailure(key: string, options: RateLimitOptions): void {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + options.windowMs });
    return;
  }
  bucket.count += 1;
}

/** Clear a key's failures — call on a successful attempt. */
export function clearAttempts(key: string): void {
  buckets.delete(key);
}

/** Test-only: clear all buckets. */
export function resetRateLimits(): void {
  buckets.clear();
}
