import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { env } from "@/lib/env";

// The three secrets of an authorization-code flow, kept in one signed cookie
// for the ~seconds the user spends at Google:
//
//   state    — comes back in the URL and must match, which is what stops a
//              third party from feeding us their own authorization code.
//   nonce    — comes back *inside* the ID token, which binds that token to the
//              browser that started the flow (replay protection).
//   verifier — PKCE: proves the code is redeemed by whoever requested it, so a
//              code leaked from the redirect URL is worthless on its own.
//
// The cookie is signed as well as httpOnly: integrity here does not depend on
// the browser keeping its promises.

const FLOW_COOKIE = "qcg_oauth_flow";
const FLOW_AUDIENCE = "qcg:oauth-flow";
const FLOW_TTL_SECONDS = 10 * 60;
const secret = new TextEncoder().encode(env.AUTH_SECRET);

export type FlowState = {
  readonly state: string;
  readonly nonce: string;
  readonly codeVerifier: string;
};

export const FLOW_COOKIE_NAME = FLOW_COOKIE;

export const FLOW_COOKIE_OPTIONS = {
  httpOnly: true,
  // "lax" still sends the cookie on Google's top-level redirect back to us,
  // which "strict" would not.
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/auth/google",
  maxAge: FLOW_TTL_SECONDS,
} as const;

const toBase64Url = (input: Buffer): string => input.toString("base64url");

const randomToken = (): string => toBase64Url(randomBytes(32));

/** PKCE S256: the challenge is what Google stores, the verifier stays here. */
export const deriveCodeChallenge = (codeVerifier: string): string =>
  toBase64Url(createHash("sha256").update(codeVerifier).digest());

export const createFlowState = (): FlowState => ({
  state: randomToken(),
  nonce: randomToken(),
  codeVerifier: randomToken(),
});

export const sealFlowState = async (flow: FlowState): Promise<string> =>
  new SignJWT({ ...flow })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience(FLOW_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${FLOW_TTL_SECONDS}s`)
    .sign(secret);

/** Returns null for anything tampered with, expired, or not a flow cookie. */
export const openFlowState = async (
  sealed: string | undefined,
): Promise<FlowState | null> => {
  if (!sealed) return null;
  try {
    const { payload } = await jwtVerify(sealed, secret, {
      audience: FLOW_AUDIENCE,
    });
    if (
      typeof payload.state !== "string" ||
      typeof payload.nonce !== "string" ||
      typeof payload.codeVerifier !== "string"
    ) {
      return null;
    }
    return {
      state: payload.state,
      nonce: payload.nonce,
      codeVerifier: payload.codeVerifier,
    };
  } catch {
    return null;
  }
};

/**
 * Constant-time comparison for the state parameter. Both values are random
 * tokens of the same length, so a length mismatch is already a rejection.
 */
export const matchesState = (expected: string, received: string): boolean => {
  const expectedBytes = Buffer.from(expected);
  const receivedBytes = Buffer.from(received);
  if (expectedBytes.length !== receivedBytes.length) return false;
  return timingSafeEqual(expectedBytes, receivedBytes);
};
