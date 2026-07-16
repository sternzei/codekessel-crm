import { test } from "node:test";
import assert from "node:assert/strict";
import type { DbHandle } from "@/db/client";
import { activityLog, magicLinkTokens, tasks } from "@/db/schema";
import { env } from "@/lib/env";
import { ACTIVE_TASK_STATUSES, isActiveTaskStatus } from "@/modules/tasks/status";
import {
  completeTaskViaToken,
  getOrIssueMagicLinkForTask,
  isMultiUseScope,
  loadTokenContext,
  markTokenUsed,
  verifyTokenSignature,
} from "@/modules/tokens/service";

// Magic-link Priority-1 hardening (F1–F3). These exercise the logic-testable
// parts against a lightweight query-builder fake — no database. DB-heavy paths
// (RLS, real rows) are covered by e2e; here we pin the behavioural guarantees.

type Row = Record<string, unknown>;

type FakeConfig = {
  // Rows returned by an atomic burn (update magic_link_tokens ... returning).
  burnReturning?: Row[];
  // Sequential results for successive select().from().where() calls.
  selectResults?: Row[][];
};

type FakeTx = {
  tx: DbHandle;
  inserts: { table: unknown; values: unknown }[];
  updates: { table: unknown; set: Row }[];
};

// Minimal drizzle-shaped stub: records inserts/updates and hands back
// configured rows so we can assert on control flow without a real connection.
function makeFakeTx(config: FakeConfig = {}): FakeTx {
  const inserts: { table: unknown; values: unknown }[] = [];
  const updates: { table: unknown; set: Row }[] = [];
  let selectIndex = 0;
  const tx = {
    insert(table: unknown) {
      return {
        values(values: unknown) {
          const record = { table, values };
          return {
            returning() {
              inserts.push(record);
              return Promise.resolve([{ id: "generated-id" }]);
            },
            then(resolve: (value: unknown) => void) {
              inserts.push(record);
              resolve(undefined);
            },
          };
        },
      };
    },
    update(table: unknown) {
      return {
        set(set: Row) {
          return {
            where() {
              updates.push({ table, set });
              const isBurn = table === magicLinkTokens && "usedAt" in set;
              return {
                returning() {
                  return Promise.resolve(
                    isBurn ? (config.burnReturning ?? [{ id: "t1" }]) : [],
                  );
                },
                then(resolve: (value: unknown) => void) {
                  resolve(undefined);
                },
              };
            },
          };
        },
      };
    },
    select() {
      return {
        from() {
          return {
            where() {
              return Promise.resolve(config.selectResults?.[selectIndex++] ?? []);
            },
          };
        },
      };
    },
  };
  return { tx: tx as unknown as DbHandle, inserts, updates };
}

type TaskRow = typeof tasks.$inferSelect;

function makeTask(over: Partial<TaskRow> = {}): TaskRow {
  return {
    id: "task-1",
    tenantId: "tenant-1",
    type: "confirm_availability",
    ownerKind: "participant",
    ownerParticipantId: "participant-1",
    ownerEmployerId: null,
    ownerUserId: null,
    status: "open",
    ...over,
  } as unknown as TaskRow;
}

// --- Shared active-status predicate (centralized, no duplication) -----------

test("isActiveTaskStatus recognizes exactly the open states", () => {
  for (const status of ACTIVE_TASK_STATUSES) {
    assert.equal(isActiveTaskStatus(status), true, `${status} is active`);
  }
  for (const status of ["done", "escalated", "cancelled"]) {
    assert.equal(isActiveTaskStatus(status), false, `${status} is closed`);
  }
});

// --- F1: intentional multi-use scopes --------------------------------------

test("multi-use scopes are the aptitude re-entry + employer wizard only", () => {
  for (const scope of [
    "start_aptitude_test",
    "employer_setup",
    "provide_betriebsnummer",
    "confirm_ags_status",
    "confirm_time_model",
  ]) {
    assert.equal(isMultiUseScope(scope), true, `${scope} stays usable`);
  }
  for (const scope of [
    "confirm_availability",
    "sign_document",
    "give_consent",
    "upload_documents",
    "confirm_submission",
  ]) {
    assert.equal(isMultiUseScope(scope), false, `${scope} is single-use`);
  }
});

// --- F1: loadTokenContext reason mapping (incl. task_closed) ----------------

async function issueRawToken(scope: string): Promise<string> {
  const url = await getOrIssueMagicLinkForTask(
    makeFakeTx().tx,
    makeTask({ type: scope }),
  );
  assert.ok(url, "helper issued a url");
  return url.slice(url.indexOf("/t/") + 3);
}

function tokenRow(over: Row = {}): Row {
  return {
    id: "tok-1",
    tenantId: "tenant-1",
    taskId: "task-1",
    subjectKind: "participant",
    subjectId: "participant-1",
    scope: "confirm_availability",
    revokedAt: null,
    usedAt: null,
    expiresAt: new Date(Date.now() + 3_600_000),
    ...over,
  };
}

test("loadTokenContext rejects a single-use link once its task is closed", async () => {
  const token = await issueRawToken("confirm_availability");
  const { tx } = makeFakeTx({
    selectResults: [
      [tokenRow({ scope: "confirm_availability" })],
      [makeTask({ status: "done" })],
    ],
  });
  const result = await loadTokenContext(tx, token);
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, "task_closed");
});

test("loadTokenContext keeps aptitude re-entry working after task close", async () => {
  const token = await issueRawToken("start_aptitude_test");
  const { tx } = makeFakeTx({
    selectResults: [
      [tokenRow({ scope: "start_aptitude_test" })],
      [makeTask({ status: "done", type: "start_aptitude_test" })],
    ],
  });
  const result = await loadTokenContext(tx, token);
  assert.equal(result.ok, true);
});

test("loadTokenContext maps used/revoked/expired before touching the task", async () => {
  const token = await issueRawToken("confirm_availability");
  const cases: Array<[Row, string]> = [
    [{ revokedAt: new Date() }, "revoked"],
    [{ usedAt: new Date() }, "used"],
    [{ expiresAt: new Date(Date.now() - 1_000) }, "expired"],
  ];
  for (const [over, reason] of cases) {
    const { tx } = makeFakeTx({ selectResults: [[tokenRow(over)]] });
    const result = await loadTokenContext(tx, token);
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, reason);
  }
});

// --- F3: link shape + supersede-on-issue -----------------------------------

test("getOrIssueMagicLinkForTask returns a verifiable /t/<jwt> url", async () => {
  const { tx } = makeFakeTx();
  const url = await getOrIssueMagicLinkForTask(tx, makeTask());
  assert.ok(url);
  assert.ok(url.startsWith(`${env.APP_BASE_URL}/t/`), "url is a /t/ link");
  const jwt = url.slice(url.indexOf("/t/") + 3);
  assert.equal(jwt.split(".").length, 3, "payload is a signed JWT");
  const verified = await verifyTokenSignature(jwt);
  assert.equal(verified?.tenantId, "tenant-1");
});

test("issuing a link supersedes live tokens before minting the new one", async () => {
  const fake = makeFakeTx();
  await getOrIssueMagicLinkForTask(fake.tx, makeTask());
  const revoke = fake.updates.find(
    (u) => u.table === magicLinkTokens && "revokedAt" in u.set,
  );
  assert.ok(revoke, "prior unused tokens are revoked");
  const mint = fake.inserts.find((i) => i.table === magicLinkTokens);
  assert.ok(mint, "a fresh token is inserted");
});

test("getOrIssueMagicLinkForTask returns null when there is no external subject", async () => {
  assert.equal(
    await getOrIssueMagicLinkForTask(
      makeFakeTx().tx,
      makeTask({ ownerKind: "internal_user", ownerParticipantId: null }),
    ),
    null,
  );
  assert.equal(
    await getOrIssueMagicLinkForTask(
      makeFakeTx().tx,
      makeTask({ ownerParticipantId: null }),
    ),
    null,
  );
});

// --- F2: atomic single-use burn --------------------------------------------

test("markTokenUsed burns once and reports whether it won the race", async () => {
  const won = makeFakeTx({ burnReturning: [{ id: "tok-1" }] });
  assert.equal(await markTokenUsed(won.tx, tokenRow() as never), true);
  assert.equal(
    won.inserts.filter((i) => i.table === activityLog).length,
    1,
    "a burn logs token_used exactly once",
  );

  const lost = makeFakeTx({ burnReturning: [] });
  assert.equal(await markTokenUsed(lost.tx, tokenRow() as never), false);
  assert.equal(
    lost.inserts.filter((i) => i.table === activityLog).length,
    0,
    "a lost race logs nothing",
  );
});

test("completeTaskViaToken performs no task side effects on a lost race", async () => {
  const lost = makeFakeTx({ burnReturning: [] });
  const done = await completeTaskViaToken(lost.tx, {
    tokenRow: tokenRow() as never,
    task: makeTask(),
  });
  assert.equal(done, false);
  assert.equal(
    lost.updates.some((u) => u.table === tasks),
    false,
    "the task is never flipped to done when the burn loses",
  );
});

test("completeTaskViaToken closes the task exactly once when it wins", async () => {
  const won = makeFakeTx({ burnReturning: [{ id: "tok-1" }] });
  const done = await completeTaskViaToken(won.tx, {
    tokenRow: tokenRow() as never,
    task: makeTask(),
  });
  assert.equal(done, true);
  const taskUpdates = won.updates.filter((u) => u.table === tasks);
  assert.equal(taskUpdates.length, 1);
  assert.equal(taskUpdates[0]?.set.status, "done");
});
