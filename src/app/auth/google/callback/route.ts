import { cookies, headers } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { rateLimitClientKey } from "@/lib/client-ip";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import {
  isRateLimitedAsync,
  recordFailureAsync,
} from "@/lib/rate-limit-store";
import { getGoogleConfig } from "@/modules/auth/google/config";
import {
  FLOW_COOKIE_NAME,
  FLOW_COOKIE_OPTIONS,
  matchesState,
  openFlowState,
} from "@/modules/auth/google/flow-state";
import { exchangeCodeForIdentity } from "@/modules/auth/google/oidc";
import { resolveGoogleAccount } from "@/modules/auth/google/registration";
import { createSession } from "@/modules/auth/session";

// Every rejected callback is counted: a caller who cannot get past state
// validation has no business retrying dozens of times.
const CALLBACK_LIMIT = 20;
const CALLBACK_WINDOW_MS = 5 * 60_000;
const CALLBACK_OPTS = { limit: CALLBACK_LIMIT, windowMs: CALLBACK_WINDOW_MS };

export const dynamic = "force-dynamic";

const redirectTo = (path: string): NextResponse =>
  NextResponse.redirect(new URL(path, env.APP_BASE_URL));

/**
 * Completes the Google flow.
 *
 * Order matters: state is checked before the authorization code is spent, and
 * the single-use flow cookie is dropped before any outcome is returned, so a
 * replayed callback URL cannot be redeemed twice.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const config = getGoogleConfig();
  if (!config) return redirectTo("/auth/sign-in");

  const headerStore = await headers();
  const limitKey = `oauth:callback:${rateLimitClientKey(headerStore)}`;
  if ((await isRateLimitedAsync(limitKey, CALLBACK_OPTS)).limited) {
    return redirectTo("/auth/sign-in?error=rate");
  }

  const cookieStore = await cookies();
  const flow = await openFlowState(cookieStore.get(FLOW_COOKIE_NAME)?.value);
  // One flow cookie, one attempt — dropped regardless of how this ends.
  cookieStore.delete({ name: FLOW_COOKIE_NAME, path: FLOW_COOKIE_OPTIONS.path });

  const params = request.nextUrl.searchParams;
  const state = params.get("state");
  const code = params.get("code");

  if (params.get("error")) {
    // The user declined the consent screen, or Google refused. Not our failure.
    return redirectTo("/auth/sign-in?error=google");
  }

  if (!flow || !state || !code || !matchesState(flow.state, state)) {
    await recordFailureAsync(limitKey, CALLBACK_OPTS);
    logger.warn("google.callback_rejected", {
      reason: !flow ? "no_flow_cookie" : !code ? "no_code" : "state_mismatch",
    });
    return redirectTo("/auth/sign-in?error=google");
  }

  const exchange = await exchangeCodeForIdentity(config, { code, flow });
  if (!exchange.ok) {
    await recordFailureAsync(limitKey, CALLBACK_OPTS);
    logger.warn("google.callback_failed", { reason: exchange.reason });
    return redirectTo(
      exchange.reason === "email_unverified"
        ? "/auth/sign-in?error=google_unverified"
        : "/auth/sign-in?error=google",
    );
  }

  const outcome = await resolveGoogleAccount(exchange.identity);
  if (outcome.kind !== "signed_in") {
    // Anything short of a sign-in costs the caller budget, including a
    // successful registration: one address should not be able to create rows
    // in the approval queue all afternoon.
    await recordFailureAsync(limitKey, CALLBACK_OPTS);
  }
  switch (outcome.kind) {
    case "signed_in":
      // Writing a fresh session cookie also rotates any pre-existing one.
      await createSession(outcome.user);
      return redirectTo("/pipeline");
    case "pending":
      return redirectTo("/auth/pending");
    case "rejected":
      return redirectTo("/auth/pending?state=rejected");
    case "deactivated":
      return redirectTo("/auth/pending?state=deactivated");
    case "conflict":
      return redirectTo("/auth/sign-in?error=google_conflict");
    case "registration_closed":
      return redirectTo("/auth/sign-in?error=google_closed");
  }
}
