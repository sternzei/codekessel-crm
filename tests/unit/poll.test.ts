import { test } from "node:test";
import assert from "node:assert/strict";
import { computePollDelay } from "@/jobs/poll";

test("computePollDelay returns the base interval when jitter is disabled", () => {
  assert.equal(computePollDelay({ baseMs: 15_000, maxJitterMs: 0 }), 15_000);
});

test("computePollDelay adds no jitter when the RNG yields 0", () => {
  const actual = computePollDelay({ baseMs: 15_000, maxJitterMs: 3_000, random: () => 0 });
  assert.equal(actual, 15_000);
});

test("computePollDelay adds bounded jitter for a high RNG value", () => {
  const actual = computePollDelay({
    baseMs: 15_000,
    maxJitterMs: 3_000,
    random: () => 0.999,
  });
  assert.equal(actual, 15_000 + Math.floor(0.999 * 3_000));
});

test("computePollDelay stays within [base, base + maxJitter)", () => {
  for (const r of [0, 0.25, 0.5, 0.75, 0.999999]) {
    const actual = computePollDelay({ baseMs: 15_000, maxJitterMs: 3_000, random: () => r });
    assert.ok(actual >= 15_000, "never below the base interval");
    assert.ok(actual < 15_000 + 3_000, "never reaches base + maxJitter");
  }
});
