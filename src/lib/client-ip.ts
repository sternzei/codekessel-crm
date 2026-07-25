// Client-IP resolution with an explicit trust boundary.
//
// `x-forwarded-for` is client-controlled input: reached directly, anyone can
// send any value, so a rate limiter keyed on its FIRST entry is trivially
// evaded (rotate the header, get a fresh bucket). The header is therefore
// honored only when the app sits behind a trusted reverse proxy / load
// balancer that APPENDS the real peer address (TRUST_PROXY=true). In that
// mode the LAST entry is the one our proxy added — every earlier entry is
// still attacker-controlled. Without a trusted proxy the header is ignored
// entirely: rate limiting falls back to one shared bucket (fail closed) and
// audit trails record no IP rather than a spoofable one.

function trustProxy(): boolean {
  const v = process.env.TRUST_PROXY;
  return v === "true" || v === "1";
}

type HeaderSource = { get(name: string): string | null };

/**
 * The request's client IP, or null when it cannot be known honestly (no
 * trusted proxy configured, or the header is absent/empty). Read at call
 * time so infra config applies without a rebuild.
 */
export function requestClientIp(headerStore: HeaderSource): string | null {
  if (!trustProxy()) return null;
  const last = headerStore.get("x-forwarded-for")?.split(",").pop()?.trim();
  return last || null;
}

/**
 * Rate-limit bucket key for the caller. Without a knowable IP every caller
 * shares one "untrusted" bucket — coarse, but not evadable by header
 * spoofing.
 */
export function rateLimitClientKey(headerStore: HeaderSource): string {
  return requestClientIp(headerStore) ?? "untrusted";
}
