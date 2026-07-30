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

test("records every call and blocks once the budget is exhausted", async () => {
  assert.equal(await isExternalRequestThrottled("k", OPTS), false); // 1
  assert.equal(await isExternalRequestThrottled("k", OPTS), false); // 2
  assert.equal(await isExternalRequestThrottled("k", OPTS), false); // 3 (== limit)
  assert.equal(await isExternalRequestThrottled("k", OPTS), true); // 4 > limit
});

test("stays blocked for further calls within the window", async () => {
  for (let i = 0; i < 3; i += 1) {
    assert.equal(await isExternalRequestThrottled("k", OPTS), false);
  }
  assert.equal(await isExternalRequestThrottled("k", OPTS), true);
  assert.equal(await isExternalRequestThrottled("k", OPTS), true);
});

test("page keys are isolated by IP", async () => {
  const opts = { limit: 1, windowMs: 60_000 };
  assert.equal(await isExternalRequestThrottled(tokenPageKey("1.1.1.1"), opts), false);
  assert.equal(await isExternalRequestThrottled(tokenPageKey("1.1.1.1"), opts), true);
  assert.equal(await isExternalRequestThrottled(tokenPageKey("2.2.2.2"), opts), false);
});

test("page and action budgets are independent", async () => {
  const opts = { limit: 1, windowMs: 60_000 };
  assert.equal(await isExternalRequestThrottled(tokenPageKey("9.9.9.9"), opts), false);
  assert.equal(await isExternalRequestThrottled(tokenPageKey("9.9.9.9"), opts), true);
  assert.equal(
    await isExternalRequestThrottled(tokenActionKey("9.9.9.9"), opts),
    false,
  );
});

test("window expiry re-opens the budget", async () => {
  const opts = { limit: 1, windowMs: 5 };
  assert.equal(await isExternalRequestThrottled("k", opts), false);
  assert.equal(await isExternalRequestThrottled("k", opts), true);
  const orig = Date.now;
  Date.now = () => orig() + 10;
  try {
    assert.equal(await isExternalRequestThrottled("k", opts), false);
  } finally {
    Date.now = orig;
  }
});

test("real budgets keep the page limit more generous than the action limit", () => {
  assert.ok(TOKEN_PAGE_LIMIT.limit > TOKEN_ACTION_LIMIT.limit);
  assert.equal(TOKEN_PAGE_LIMIT.windowMs, 60_000);
  assert.equal(TOKEN_ACTION_LIMIT.windowMs, 60_000);
});
