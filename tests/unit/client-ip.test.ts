import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { rateLimitClientKey, requestClientIp } from "@/lib/client-ip";

// .env.local sets TRUST_PROXY=true for the E2E spoof test, so capture and
// restore the ambient value around each case rather than assuming it is unset.
const ORIGINAL_TRUST_PROXY = process.env.TRUST_PROXY;

const headers = (
  entries: Record<string, string>,
): { get(name: string): string | null } => ({
  get: (name: string) => entries[name] ?? null,
});

afterEach(() => {
  if (ORIGINAL_TRUST_PROXY === undefined) {
    delete process.env.TRUST_PROXY;
    return;
  }
  process.env.TRUST_PROXY = ORIGINAL_TRUST_PROXY;
});

test("without a trusted proxy x-forwarded-for is ignored entirely", () => {
  delete process.env.TRUST_PROXY;
  const h = headers({ "x-forwarded-for": "1.2.3.4" });
  assert.equal(requestClientIp(h), null);
  // Fail closed: one shared bucket, not evadable by header spoofing.
  assert.equal(rateLimitClientKey(h), "untrusted");
});

test("TRUST_PROXY=true honours the LAST forwarded entry (proxy-appended hop)", () => {
  process.env.TRUST_PROXY = "true";
  const h = headers({ "x-forwarded-for": "9.9.9.9, 10.0.0.5, 203.0.113.7" });
  assert.equal(requestClientIp(h), "203.0.113.7");
  assert.equal(rateLimitClientKey(h), "203.0.113.7");
});

test("TRUST_PROXY=1 is also accepted", () => {
  process.env.TRUST_PROXY = "1";
  assert.equal(requestClientIp(headers({ "x-forwarded-for": "203.0.113.7" })), "203.0.113.7");
});

test("a spoofed leading entry cannot displace the trusted last hop", () => {
  process.env.TRUST_PROXY = "true";
  // The attacker controls "6.6.6.6"; only the proxy-appended last hop counts.
  const h = headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.7" });
  assert.equal(requestClientIp(h), "203.0.113.7");
});

test("a missing or empty header yields no IP even behind a trusted proxy", () => {
  process.env.TRUST_PROXY = "true";
  assert.equal(requestClientIp(headers({})), null);
  assert.equal(requestClientIp(headers({ "x-forwarded-for": "" })), null);
  assert.equal(rateLimitClientKey(headers({})), "untrusted");
});

test("a non-true TRUST_PROXY value falls back to fail closed", () => {
  process.env.TRUST_PROXY = "yes";
  const h = headers({ "x-forwarded-for": "1.2.3.4" });
  assert.equal(requestClientIp(h), null);
  assert.equal(rateLimitClientKey(h), "untrusted");
});
