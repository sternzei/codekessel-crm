import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_MAGIC_LINK_TTL_HOURS,
  MAX_MAGIC_LINK_TTL_HOURS,
  MIN_MAGIC_LINK_TTL_HOURS,
  clampTtlHours,
  computeTokenExpiry,
  resolveTokenTtlHours,
} from "@/modules/tokens/policy";

test("default TTL is seven days (unchanged behaviour)", () => {
  assert.equal(DEFAULT_MAGIC_LINK_TTL_HOURS, 168);
  assert.equal(resolveTokenTtlHours(), 168);
});

test("clampTtlHours keeps in-range values and clamps out-of-range ones", () => {
  assert.equal(clampTtlHours(72), 72);
  assert.equal(clampTtlHours(MAX_MAGIC_LINK_TTL_HOURS + 1000), MAX_MAGIC_LINK_TTL_HOURS);
  assert.equal(clampTtlHours(0.5), MIN_MAGIC_LINK_TTL_HOURS);
});

test("clampTtlHours falls back to default for junk input", () => {
  assert.equal(clampTtlHours(0), DEFAULT_MAGIC_LINK_TTL_HOURS);
  assert.equal(clampTtlHours(-5), DEFAULT_MAGIC_LINK_TTL_HOURS);
  assert.equal(clampTtlHours(Number.NaN), DEFAULT_MAGIC_LINK_TTL_HOURS);
});

test("resolveTokenTtlHours precedence: request > configured > default", () => {
  assert.equal(
    resolveTokenTtlHours({ requestedTtlHours: 24, configuredTtlHours: 240 }),
    24,
  );
  assert.equal(resolveTokenTtlHours({ configuredTtlHours: 240 }), 240);
  assert.equal(resolveTokenTtlHours({}), DEFAULT_MAGIC_LINK_TTL_HOURS);
});

test("resolveTokenTtlHours clamps a misconfigured deployment default", () => {
  assert.equal(
    resolveTokenTtlHours({ configuredTtlHours: 100_000 }),
    MAX_MAGIC_LINK_TTL_HOURS,
  );
});

test("computeTokenExpiry adds the TTL to the given instant", () => {
  const now = new Date("2026-01-01T00:00:00Z");
  assert.deepEqual(computeTokenExpiry(24, now), new Date("2026-01-02T00:00:00Z"));
});
