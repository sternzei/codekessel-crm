import type { JWTPayload } from "jose";

/**
 * The parts of a Google ID token this app trusts. Signature, issuer, audience
 * and expiry are checked by `jose` before this ever runs (see oidc.ts); what is
 * left are the claims whose *meaning* matters to us.
 */
export type GoogleIdentity = {
  readonly subject: string;
  readonly email: string;
  readonly name: string;
};

export type GoogleClaimRejection =
  | "subject_missing"
  | "email_missing"
  | "email_unverified"
  | "nonce_mismatch";

export type GoogleClaimResult =
  | { readonly ok: true; readonly identity: GoogleIdentity }
  | { readonly ok: false; readonly reason: GoogleClaimRejection };

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

/** Google sends this as a boolean, but older clients have seen the string. */
const isVerified = (value: unknown): boolean =>
  value === true || value === "true";

/** Falls back to the local part so the approval queue never shows a blank row. */
const deriveName = (payload: JWTPayload, email: string): string =>
  asString(payload.name) ?? email.split("@")[0];

/**
 * Turns a verified ID token into an identity, or explains why it is unusable.
 *
 * The two rejections that carry security weight:
 *  - `email_unverified`: without it anyone could claim any address and get
 *    linked into an existing account by email.
 *  - `nonce_mismatch`: binds the token to the browser that started the flow,
 *    so a token captured elsewhere cannot be replayed into this session.
 */
export const evaluateGoogleClaims = (
  payload: JWTPayload,
  expected: { readonly nonce: string },
): GoogleClaimResult => {
  const subject = asString(payload.sub);
  if (!subject) return { ok: false, reason: "subject_missing" };

  if (asString(payload.nonce) !== expected.nonce) {
    return { ok: false, reason: "nonce_mismatch" };
  }

  const email = asString(payload.email)?.toLowerCase() ?? null;
  if (!email) return { ok: false, reason: "email_missing" };
  if (!isVerified(payload.email_verified)) {
    return { ok: false, reason: "email_unverified" };
  }

  return {
    ok: true,
    identity: { subject, email, name: deriveName(payload, email) },
  };
};
