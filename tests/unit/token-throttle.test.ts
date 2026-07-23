import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { resetRateLimits } from "@/lib/rate-limit";
import {
  TOKEN_ACTION_LIMIT,
  TOKEN_PAGE_LIMIT,
  isExternalRequestThrottled,
  tokenActionKey,
  tokenPageKey,
} from "@/modules/tokens/throttle";

beforeEach(() => resetRateLimits());

const OPTS = { limit: 3, windowMs: 60_000 };

test("allows exactly `limit` requests, then throttles the next one", () => {
  assert.equal(isExternalRequestThrottled("k", OPTS), false); // 1
  assert.equal(isExternalRequestThrottled("k", OPTS), false); // 2
  assert.equal(isExternalRequestThrottled("k", OPTS), false); // 3 (== limit)
  assert.equal(isExternalRequestThrottled("k", OPTS), true); // 4 > limit
});

test("counts reads too — no success clears the bucket (volumetric)", () => {
  for (let i = 0; i < OPTS.limit; i += 1) {
    assert.equal(isExternalRequestThrottled("k", OPTS), false);
  }
  assert.equal(isExternalRequestThrottled("k", OPTS), true);
  assert.equal(isExternalRequestThrottled("k", OPTS), true);
});

test("per-IP keys are isolated", () => {
  const opts = { limit: 1, windowMs: 60_000 };
  assert.equal(isExternalRequestThrottled(tokenPageKey("1.1.1.1"), opts), false);
  assert.equal(isExternalRequestThrottled(tokenPageKey("1.1.1.1"), opts), true);
  assert.equal(isExternalRequestThrottled(tokenPageKey("2.2.2.2"), opts), false);
});

test("page and action budgets share no bucket for the same IP", () => {
  const opts = { limit: 1, windowMs: 60_000 };
  assert.equal(isExternalRequestThrottled(tokenPageKey("9.9.9.9"), opts), false);
  assert.equal(isExternalRequestThrottled(tokenPageKey("9.9.9.9"), opts), true);
  // The action bucket for the same IP is a distinct key, so still open.
  assert.equal(
    isExternalRequestThrottled(tokenActionKey("9.9.9.9"), opts),
    false,
  );
});

test("window expiry re-opens the budget", () => {
  const opts = { limit: 1, windowMs: 5 };
  assert.equal(isExternalRequestThrottled("k", opts), false);
  assert.equal(isExternalRequestThrottled("k", opts), true);
  const orig = Date.now;
  Date.now = () => orig() + 10;
  try {
    assert.equal(isExternalRequestThrottled("k", opts), false);
  } finally {
    Date.now = orig;
  }
});

test("real budgets keep the page limit more generous than the action limit", () => {
  assert.ok(TOKEN_PAGE_LIMIT.limit > TOKEN_ACTION_LIMIT.limit);
  assert.equal(TOKEN_PAGE_LIMIT.windowMs, 60_000);
  assert.equal(TOKEN_ACTION_LIMIT.windowMs, 60_000);
});
