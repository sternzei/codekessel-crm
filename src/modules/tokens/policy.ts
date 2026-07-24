// Single source of the magic-link token TTL/expiry policy. Centralised here so
// the issue path, any future re-issue tuning, and tests all agree on one set of
// rules instead of scattering `7 * 24` literals. Pure + DB/network-free.
//
// Rotation note: re-issuing a link never extends an old credential — it mints a
// fresh token and supersedes (revokes) the previous live one via
// `getOrIssueMagicLinkForTask` → `revokeUnusedTokensForTask` (service.ts). So a
// re-issue always resets the TTL on a brand-new token, and at most one link is
// ever valid for a task.

/** 7 days — the historical default, kept so behaviour is unchanged by default. */
export const DEFAULT_MAGIC_LINK_TTL_HOURS = 7 * 24;

// Guardrails so a misconfigured deployment value can neither mint an
// effectively-immortal link nor an already-useless (sub-hour) one.
export const MIN_MAGIC_LINK_TTL_HOURS = 1;
export const MAX_MAGIC_LINK_TTL_HOURS = 30 * 24;

/** Clamp any TTL into [MIN, MAX]; a non-finite/non-positive value → default. */
export function clampTtlHours(hours: number): number {
  if (!Number.isFinite(hours) || hours <= 0) return DEFAULT_MAGIC_LINK_TTL_HOURS;
  return Math.min(Math.max(hours, MIN_MAGIC_LINK_TTL_HOURS), MAX_MAGIC_LINK_TTL_HOURS);
}

export type ResolveTtlParams = {
  /** Explicit TTL from the caller (issueMagicLink's ttlHours arg), if any. */
  requestedTtlHours?: number;
  /** Deployment default from env (MAGIC_LINK_TTL_HOURS), if configured. */
  configuredTtlHours?: number;
};

/**
 * Resolve the effective TTL in hours. Precedence: an explicit per-issue request
 * wins, else the deployment-configured default, else the built-in default — and
 * the result is always clamped to the guardrails.
 */
export function resolveTokenTtlHours(params: ResolveTtlParams = {}): number {
  const raw =
    params.requestedTtlHours ??
    params.configuredTtlHours ??
    DEFAULT_MAGIC_LINK_TTL_HOURS;
  return clampTtlHours(raw);
}

/** Absolute expiry instant for a token minted now (or at an injected `now`). */
export function computeTokenExpiry(ttlHours: number, now: Date = new Date()): Date {
  return new Date(now.getTime() + ttlHours * 60 * 60 * 1000);
}
