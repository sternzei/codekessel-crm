import { headers } from "next/headers";
import { rateLimitClientKey } from "@/lib/client-ip";
import {
  TOKEN_ACTION_LIMIT,
  TOKEN_PAGE_LIMIT,
  isExternalRequestThrottled,
  tokenActionKey,
  tokenPageKey,
} from "./throttle";

// Server-only wrappers that resolve the client IP from the request headers and
// apply the per-IP magic-link budgets. Kept out of throttle.ts so the pure
// limiter stays importable from unit tests without pulling in next/headers.

/**
 * Shared trust-boundary resolver (lib/client-ip): x-forwarded-for is only
 * honored behind TRUST_PROXY=true (LAST entry); otherwise every caller shares
 * one fail-closed bucket — never a spoofable per-attacker bucket.
 */
async function resolveClientIp(): Promise<string> {
  return rateLimitClientKey(await headers());
}

/** True when this client IP has exhausted the anonymous `/t/*` page budget. */
export async function isExternalPageThrottled(): Promise<boolean> {
  const clientIp = await resolveClientIp();
  return isExternalRequestThrottled(tokenPageKey(clientIp), TOKEN_PAGE_LIMIT);
}

/** True when this client IP has exhausted the magic-link submission budget. */
export async function isExternalActionThrottled(): Promise<boolean> {
  const clientIp = await resolveClientIp();
  return isExternalRequestThrottled(tokenActionKey(clientIp), TOKEN_ACTION_LIMIT);
}
