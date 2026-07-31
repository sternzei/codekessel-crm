import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { rateLimitClientKey } from "@/lib/client-ip";
import { env } from "@/lib/env";
import {
  isRateLimitedAsync,
  recordFailureAsync,
} from "@/lib/rate-limit-store";
import { getGoogleConfig } from "@/modules/auth/google/config";
import {
  createFlowState,
  FLOW_COOKIE_NAME,
  FLOW_COOKIE_OPTIONS,
  sealFlowState,
} from "@/modules/auth/google/flow-state";
import { buildAuthorizationUrl } from "@/modules/auth/google/oidc";
import { getSession } from "@/modules/auth/session";

// Starts the authorization-code flow. Every start is counted, not just the
// failures, because this endpoint costs us a signed cookie and a redirect
// regardless of the outcome. The budget is generous: behind a trusted proxy a
// whole office shares one address, and a sign-in is a once-a-day act — this is
// aimed at automation, not at a busy Monday morning.
const START_LIMIT = 60;
const START_WINDOW_MS = 5 * 60_000;
const START_OPTS = { limit: START_LIMIT, windowMs: START_WINDOW_MS };

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const config = getGoogleConfig();
  // Not configured is not an error the visitor can act on, and saying so would
  // leak deployment detail.
  if (!config) {
    return NextResponse.redirect(new URL("/auth/sign-in", env.APP_BASE_URL));
  }

  const session = await getSession();
  if (session) {
    return NextResponse.redirect(new URL("/pipeline", env.APP_BASE_URL));
  }

  const headerStore = await headers();
  const key = `oauth:start:${rateLimitClientKey(headerStore)}`;
  if ((await isRateLimitedAsync(key, START_OPTS)).limited) {
    return NextResponse.redirect(
      new URL("/auth/sign-in?error=rate", env.APP_BASE_URL),
    );
  }
  await recordFailureAsync(key, START_OPTS);

  const flow = createFlowState();
  const cookieStore = await cookies();
  cookieStore.set(FLOW_COOKIE_NAME, await sealFlowState(flow), {
    ...FLOW_COOKIE_OPTIONS,
  });

  return NextResponse.redirect(buildAuthorizationUrl(config, flow));
}
