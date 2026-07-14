import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  clearAttempts,
  isRateLimited,
  recordFailure,
  resetRateLimits,
} from "@/lib/rate-limit";

beforeEach(() => resetRateLimits());

const OPTS = { limit: 3, windowMs: 60_000 };

test("blocks only after failures reach the limit", () => {
  assert.equal(isRateLimited("k", OPTS).limited, false);
  recordFailure("k", OPTS);
  recordFailure("k", OPTS);
  assert.equal(isRateLimited("k", OPTS).limited, false); // 2 < 3
  recordFailure("k", OPTS);
  const status = isRateLimited("k", OPTS);
  assert.equal(status.limited, true); // 3 >= 3
  assert.ok(status.retryAfterMs > 0);
});

test("a success (clearAttempts) resets the counter", () => {
  recordFailure("k", OPTS);
  recordFailure("k", OPTS);
  recordFailure("k", OPTS);
  assert.equal(isRateLimited("k", OPTS).limited, true);
  clearAttempts("k");
  assert.equal(isRateLimited("k", OPTS).limited, false);
});

test("keys are isolated from one another", () => {
  const opts = { limit: 1, windowMs: 60_000 };
  recordFailure("a", opts);
  assert.equal(isRateLimited("a", opts).limited, true);
  assert.equal(isRateLimited("b", opts).limited, false);
});

test("window expiry re-opens the budget", () => {
  const opts = { limit: 1, windowMs: 5 };
  recordFailure("k", opts);
  assert.equal(isRateLimited("k", opts).limited, true);
  const orig = Date.now;
  Date.now = () => orig() + 10;
  try {
    assert.equal(isRateLimited("k", opts).limited, false);
  } finally {
    Date.now = orig;
  }
});
