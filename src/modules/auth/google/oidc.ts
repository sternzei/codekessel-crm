import { createRemoteJWKSet, jwtVerify } from "jose";
import { logger } from "@/lib/logger";
import {
  GOOGLE_AUTHORIZATION_ENDPOINT,
  GOOGLE_ISSUER,
  GOOGLE_JWKS_URI,
  GOOGLE_TOKEN_ENDPOINT,
  type GoogleConfig,
} from "./config";
import {
  evaluateGoogleClaims,
  type GoogleClaimResult,
  type GoogleIdentity,
} from "./claims";
import { deriveCodeChallenge, type FlowState } from "./flow-state";

const TOKEN_REQUEST_TIMEOUT_MS = 10_000;

// Cached across requests by the module system; refreshes itself when Google
// rotates keys.
const jwks = createRemoteJWKSet(new URL(GOOGLE_JWKS_URI));

/** Where to send the browser to start the flow. */
export const buildAuthorizationUrl = (
  config: GoogleConfig,
  flow: FlowState,
): string => {
  const url = new URL(GOOGLE_AUTHORIZATION_ENDPOINT);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  // Identity only. No Gmail, Drive or contacts scope is requested, so an
  // approval here can never turn into access to the person's data.
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", flow.state);
  url.searchParams.set("nonce", flow.nonce);
  url.searchParams.set("code_challenge", deriveCodeChallenge(flow.codeVerifier));
  url.searchParams.set("code_challenge_method", "S256");
  // No refresh token: this app talks to Google exactly once per sign-in and
  // has nothing to do with an offline grant.
  url.searchParams.set("access_type", "online");
  url.searchParams.set("prompt", "select_account");
  return url.toString();
};

export type ExchangeFailure =
  | "token_request_failed"
  | "id_token_missing"
  | "id_token_invalid";

export type ExchangeResult =
  | { readonly ok: true; readonly identity: GoogleIdentity }
  | { readonly ok: false; readonly reason: ExchangeFailure | string };

const requestIdToken = async (
  config: GoogleConfig,
  code: string,
  codeVerifier: string,
): Promise<string | null> => {
  const body = new URLSearchParams({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    grant_type: "authorization_code",
    code_verifier: codeVerifier,
  });
  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!response.ok) {
    // The response body can echo the client secret back in an error hint, so
    // only the status is logged.
    logger.warn("google.token_exchange_failed", { status: response.status });
    return null;
  }
  const payload = (await response.json()) as { id_token?: unknown };
  return typeof payload.id_token === "string" ? payload.id_token : null;
};

/**
 * Redeems the authorization code and returns the identity Google vouches for.
 *
 * `jwtVerify` here is the load-bearing step: it checks the signature against
 * Google's published keys and pins issuer, audience and expiry. Without the
 * audience pin, an ID token minted for a different application would be
 * accepted — the classic OIDC confused-deputy bug.
 */
export const exchangeCodeForIdentity = async (
  config: GoogleConfig,
  params: { readonly code: string; readonly flow: FlowState },
): Promise<ExchangeResult> => {
  let idToken: string | null;
  try {
    idToken = await requestIdToken(config, params.code, params.flow.codeVerifier);
  } catch (error) {
    logger.warn("google.token_exchange_error", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return { ok: false, reason: "token_request_failed" };
  }
  if (!idToken) return { ok: false, reason: "id_token_missing" };

  let claims: GoogleClaimResult;
  try {
    const { payload } = await jwtVerify(idToken, jwks, {
      issuer: GOOGLE_ISSUER,
      audience: config.clientId,
    });
    claims = evaluateGoogleClaims(payload, { nonce: params.flow.nonce });
  } catch (error) {
    logger.warn("google.id_token_invalid", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return { ok: false, reason: "id_token_invalid" };
  }

  if (!claims.ok) return { ok: false, reason: claims.reason };
  return { ok: true, identity: claims.identity };
};
