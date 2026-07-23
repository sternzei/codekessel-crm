import {
  isRateLimited,
  recordFailure,
  type RateLimitOptions,
} from "@/lib/rate-limit";

// P3: throttle the anonymous magic-link surface (`/t/*`). Reuses the in-memory
// per-IP limiter from lib/rate-limit. NOTE: buckets live in THIS Node process
// only — behind more than one instance every replica keeps its own counters,
// so the effective global budget is `limit × instances`. Fine for the single-
// node MVP; move the buckets to Redis/Postgres for a hard cross-instance cap.

// Page loads are cheap and the intentional multi-use scopes (start_aptitude_test
// and the employer setup wizard) legitimately re-open the SAME link many times,
// so the budget is generous and keyed PER-IP (never per-token): what we want to
// slow is token enumeration/guessing from one source, not a real re-visitor.
export const TOKEN_PAGE_LIMIT: RateLimitOptions = { limit: 60, windowMs: 60_000 };

// Mutating submissions are rarer than reads, so a tighter per-IP budget applies —
// still ample headroom for the multi-step employer wizard to save several times.
export const TOKEN_ACTION_LIMIT: RateLimitOptions = { limit: 20, windowMs: 60_000 };

/** Per-IP bucket key for anonymous `/t/*` page loads. */
export function tokenPageKey(clientIp: string): string {
  return `tpage:${clientIp}`;
}

/** Per-IP bucket key for anonymous magic-link server-action submissions. */
export function tokenActionKey(clientIp: string): string {
  return `taction:${clientIp}`;
}

/**
 * Check-and-count one anonymous magic-link request against a per-IP budget.
 * Every call is recorded, so this is a pure volumetric limiter (reads included):
 * a legitimate visitor stays far under budget while an enumerator is throttled.
 * @returns true when the caller is over budget and must be refused.
 */
export function isExternalRequestThrottled(
  key: string,
  options: RateLimitOptions,
): boolean {
  if (isRateLimited(key, options).limited) return true;
  recordFailure(key, options);
  return false;
}
