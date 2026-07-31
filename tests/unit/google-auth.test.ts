import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { SignJWT } from "jose";
import { env } from "@/lib/env";
import { evaluateGoogleClaims } from "@/modules/auth/google/claims";
import {
  createFlowState,
  deriveCodeChallenge,
  matchesState,
  openFlowState,
  sealFlowState,
} from "@/modules/auth/google/flow-state";

// Sign in with Google, minus the network. What is pinned here is exactly the
// set of checks that decide whether a stranger gets an account: the claims we
// insist on, and the flow secrets that tie a callback to the browser that
// started it.

const NONCE = "test-nonce-value";

const baseClaims = {
  sub: "108120912093812093",
  email: "Neue.Person@example.com",
  email_verified: true,
  name: "Neue Person",
  nonce: NONCE,
};

/** A token Google could plausibly send that is simply missing one claim. */
const withoutClaim = (claim: keyof typeof baseClaims): Record<string, unknown> => {
  const claims: Record<string, unknown> = { ...baseClaims };
  delete claims[claim];
  return claims;
};

test("a verified Google account yields an identity", () => {
  const actual = evaluateGoogleClaims(baseClaims, { nonce: NONCE });

  assert.equal(actual.ok, true);
  assert.deepEqual(actual.ok && actual.identity, {
    subject: "108120912093812093",
    // Lowercased so it can never create a second row for the same person.
    email: "neue.person@example.com",
    name: "Neue Person",
  });
});

test("an unverified email is refused", () => {
  // Without this check, anyone could put someone else's address on a Google
  // account and get linked into that person's existing CRM user.
  const actual = evaluateGoogleClaims(
    { ...baseClaims, email_verified: false },
    { nonce: NONCE },
  );

  assert.deepEqual(actual, { ok: false, reason: "email_unverified" });
});

test("a missing email_verified claim counts as unverified", () => {
  const actual = evaluateGoogleClaims(withoutClaim("email_verified"), {
    nonce: NONCE,
  });

  assert.deepEqual(actual, { ok: false, reason: "email_unverified" });
});

test("a token minted for another flow is refused", () => {
  const actual = evaluateGoogleClaims(
    { ...baseClaims, nonce: "some-other-flow" },
    { nonce: NONCE },
  );

  assert.deepEqual(actual, { ok: false, reason: "nonce_mismatch" });
});

test("a token without a nonce is refused", () => {
  const actual = evaluateGoogleClaims(withoutClaim("nonce"), { nonce: NONCE });

  assert.deepEqual(actual, { ok: false, reason: "nonce_mismatch" });
});

test("a token without a subject or email is refused", () => {
  assert.deepEqual(evaluateGoogleClaims(withoutClaim("sub"), { nonce: NONCE }), {
    ok: false,
    reason: "subject_missing",
  });
  assert.deepEqual(evaluateGoogleClaims(withoutClaim("email"), { nonce: NONCE }), {
    ok: false,
    reason: "email_missing",
  });
});

test("a missing display name falls back to the local part", () => {
  const actual = evaluateGoogleClaims(withoutClaim("name"), { nonce: NONCE });

  assert.equal(actual.ok && actual.identity.name, "neue.person");
});

test("the flow cookie round-trips its three secrets", async () => {
  const inputFlow = createFlowState();

  const actual = await openFlowState(await sealFlowState(inputFlow));

  assert.deepEqual(actual, inputFlow);
});

test("each flow gets fresh, distinct secrets", () => {
  const first = createFlowState();
  const second = createFlowState();

  assert.notEqual(first.state, second.state);
  assert.notEqual(first.nonce, second.nonce);
  assert.notEqual(first.codeVerifier, second.codeVerifier);
  // 32 random bytes, base64url-encoded.
  assert.equal(first.state.length, 43);
});

test("a tampered or absent flow cookie opens to nothing", async () => {
  const sealed = await sealFlowState(createFlowState());

  assert.equal(await openFlowState(undefined), null);
  assert.equal(await openFlowState("not-a-token"), null);
  assert.equal(await openFlowState(`${sealed}x`), null);
});

test("a session cookie cannot be passed off as a flow cookie", async () => {
  // Both are signed with AUTH_SECRET, so the audience is what keeps the two
  // token kinds apart.
  const sessionShaped = await new SignJWT({ tid: "t", role: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("user-id")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(env.AUTH_SECRET));

  assert.equal(await openFlowState(sessionShaped), null);
});

test("an expired flow cookie opens to nothing", async () => {
  const expired = await new SignJWT({
    state: "s",
    nonce: "n",
    codeVerifier: "v",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience("qcg:oauth-flow")
    .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
    .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
    .sign(new TextEncoder().encode(env.AUTH_SECRET));

  assert.equal(await openFlowState(expired), null);
});

test("the PKCE challenge is the S256 hash of the verifier", () => {
  const inputVerifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";

  const actual = deriveCodeChallenge(inputVerifier);

  assert.equal(
    actual,
    createHash("sha256").update(inputVerifier).digest("base64url"),
  );
  // base64url only: a "+", "/" or "=" would be rejected by Google.
  assert.match(actual, /^[A-Za-z0-9_-]+$/);
});

test("state comparison accepts only an exact match", () => {
  const expected = createFlowState().state;

  assert.equal(matchesState(expected, expected), true);
  assert.equal(matchesState(expected, `${expected}extra`), false);
  assert.equal(matchesState(expected, ""), false);
  assert.equal(
    matchesState(expected, `x${expected.slice(1)}`),
    false,
  );
});
