import { headers } from "next/headers";
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

/** Same forwarded-IP heuristic used by the internal auth brute-force guard. */
async function resolveClientIp(): Promise<string> {
  const headerStore = await headers();
  return headerStore.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
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
