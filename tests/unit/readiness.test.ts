import { test } from "node:test";
import assert from "node:assert/strict";
import {
  collectReadiness,
  type CheckName,
  type CheckStatus,
} from "@/modules/health/readiness";

const always =
  (status: CheckStatus) =>
  async (): Promise<CheckStatus> =>
    status;

const never = (): Promise<CheckStatus> => new Promise(() => {});

const buildChecks = (
  overrides: Partial<Record<CheckName, () => Promise<CheckStatus>>> = {},
): Record<CheckName, () => Promise<CheckStatus>> => ({
  database: always("ok"),
  storage: always("ok"),
  worker: always("ok"),
  outbox: always("ok"),
  ...overrides,
});

test("all checks healthy reports ok", async () => {
  const actual = await collectReadiness({ checks: buildChecks(), timeoutMs: 50 });
  assert.equal(actual.status, "ok");
});

test("a check that never answers is reported as failed, not left hanging", async () => {
  const started = Date.now();
  const actual = await collectReadiness({
    checks: buildChecks({ storage: never }),
    timeoutMs: 50,
  });
  assert.equal(actual.checks.storage, "failed");
  assert.equal(actual.status, "failed");
  // The point of the change: the endpoint answers rather than holding open.
  assert.ok(Date.now() - started < 2_000);
});

test("one hanging check does not hide the others", async () => {
  const actual = await collectReadiness({
    checks: buildChecks({ storage: never, worker: always("degraded") }),
    timeoutMs: 50,
  });
  assert.equal(actual.checks.database, "ok");
  assert.equal(actual.checks.worker, "degraded");
});

test("degraded alone does not become failed", async () => {
  const actual = await collectReadiness({
    checks: buildChecks({ outbox: always("degraded") }),
    timeoutMs: 50,
  });
  assert.equal(actual.status, "degraded");
});
