import { test } from "node:test";
import assert from "node:assert/strict";
import type { DbHandle } from "@/db/client";
import { activityLog, messageDeliveries, outboundMessages } from "@/db/schema";
import {
  approveAndDispatch,
  cancelOutboundMessage,
  enqueueTaskMessage,
  isStaleSendingTimestamp,
  rejectOutboundMessage,
} from "@/modules/messaging/outbox";
import type { ChannelAdapter, OutboundMessage, SendResult } from "@/modules/messaging/types";

// Control-flow tests against a lightweight drizzle-shaped fake (no database),
// mirroring tests/unit/deliveries.test.ts. The pure state machine is covered in
// outbound-status.test.ts; here we assert the enqueue-instead-of-send behaviour
// and that dispatch happens ONLY via the approve path.

type Row = Record<string, unknown>;

type FakeConfig = {
  // Rows returned by successive select().from().where()[.orderBy()] calls.
  selectResults?: Row[][];
  // Row returned by insert().values().returning() (the created outbox row).
  insertReturning?: Row[];
  updateReturning?: Row[][];
};

function makeFakeDb(config: FakeConfig = {}) {
  const inserts: { table: unknown; values: Row }[] = [];
  const updates: { table: unknown; set: Row }[] = [];
  const selectQueue = [...(config.selectResults ?? [])];
  const updateQueue = [...(config.updateReturning ?? [])];
  let lastSelected: Row | undefined;
  const nextSelect = (): Row[] => {
    const rows = selectQueue.shift() ?? [];
    lastSelected = rows[0];
    return rows;
  };
  const db = {
    insert(table: unknown) {
      return {
        values(values: Row) {
          inserts.push({ table, values });
          return {
            returning() {
              return Promise.resolve(config.insertReturning ?? [{ id: "om-1" }]);
            },
            then(resolve: (value: unknown) => void) {
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
              const query = {
                returning() {
                  return Promise.resolve(
                    updateQueue.shift() ?? (lastSelected ? [lastSelected] : []),
                  );
                },
                then(resolve: (value: unknown) => void) {
                  resolve(undefined);
                },
              };
              return query;
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
              return {
                then(resolve: (value: unknown) => void) {
                  resolve(nextSelect());
                },
                orderBy() {
                  return Promise.resolve(nextSelect());
                },
              };
            },
          };
        },
      };
    },
  };
  return { db: db as unknown as DbHandle, inserts, updates };
}

function makeFakeAdapter(result: SendResult) {
  const sent: OutboundMessage[] = [];
  const adapter: ChannelAdapter = {
    channel: "whatsapp",
    async send(message: OutboundMessage): Promise<SendResult> {
      sent.push(message);
      return result;
    },
  };
  return { adapter, sent };
}

const makeTenantRunner =
  (db: DbHandle) =>
  async <T>(
    _tenantId: string,
    operation: (tx: DbHandle) => Promise<T>,
  ): Promise<T> =>
    operation(db);

const enqueueParams = {
  tenantId: "tenant-1",
  taskId: "task-1",
  channel: "whatsapp" as const,
  templateKey: "task_confirm_availability",
  recipient: {
    kind: "participant" as const,
    id: "participant-1",
    phone: "+49 151 1234567",
    email: "lena@example.de",
    displayName: "Lena",
  },
  variables: { firstName: "Lena", title: "Verfügbarkeit bestätigen" },
};

test("stale sending detection uses the configured age threshold", () => {
  const now = new Date("2026-07-28T12:00:00.000Z");
  assert.equal(
    isStaleSendingTimestamp(
      new Date("2026-07-28T11:44:59.000Z"),
      now,
      15,
    ),
    true,
  );
  assert.equal(
    isStaleSendingTimestamp(
      new Date("2026-07-28T11:45:01.000Z"),
      now,
      15,
    ),
    false,
  );
});

test("enqueueTaskMessage writes a pending row and never dispatches", async () => {
  // First select = renderTemplate lookup (no template → neutral fallback body).
  const fake = makeFakeDb({ selectResults: [[]] });
  const ok = await enqueueTaskMessage(fake.db, enqueueParams);
  assert.equal(ok, true);
  const outboxInsert = fake.inserts.find((i) => i.table === outboundMessages);
  assert.ok(outboxInsert, "a pending outbox row is inserted");
  assert.equal(outboxInsert?.values.status, "pending_approval");
  assert.equal(outboxInsert?.values.recipientPhone, "+49 151 1234567");
  assert.ok(typeof outboxInsert?.values.body === "string" && (outboxInsert.values.body as string).length > 0);
  const audit = fake.inserts.find((i) => i.table === activityLog);
  assert.equal(audit?.values.event, "message_queued");
});

const pendingRow: Row = {
  id: "om-1",
  tenantId: "tenant-1",
  createdByUserId: "creator-1",
  taskId: "task-1",
  channel: "whatsapp",
  templateKey: "task_confirm_availability",
  recipientKind: "participant",
  recipientId: "participant-1",
  recipientPhone: "491511234567",
  recipientEmail: null,
  recipientName: "Lena",
  subject: null,
  body: "Hallo Lena",
  variables: { firstName: "Lena", title: "X" },
  status: "pending_approval",
};

test("approveAndDispatch dispatches a pending message and records the delivery", async () => {
  const fake = makeFakeDb({ selectResults: [[pendingRow]] });
  const { adapter, sent } = makeFakeAdapter({ ok: true, providerMessageId: "wamid.X" });
  const outcome = await approveAndDispatch({
    tenantId: "tenant-1",
    messageId: "om-1",
    approvedByUserId: "user-1",
    approverRole: "manager",
    adapter,
    runWithTenant: makeTenantRunner(fake.db),
  });
  assert.equal(outcome, "dispatched");
  assert.equal(sent.length, 1, "the adapter was called exactly once");
  // First update flips to sending + stamps the approver; second to sent.
  assert.equal(fake.updates[0]?.set.status, "sending");
  assert.equal(fake.updates[0]?.set.approvedByUserId, "user-1");
  assert.equal(fake.updates[1]?.set.status, "sent");
  assert.equal(fake.updates[1]?.set.providerMessageId, "wamid.X");
  const delivery = fake.inserts.find((i) => i.table === messageDeliveries);
  assert.ok(delivery, "a message_deliveries row mirrors the provider id");
  const dispatched = fake.inserts.filter(
    (i) => i.table === activityLog && i.values.event === "message_dispatched",
  );
  assert.equal(dispatched.length, 1);
});

test("approveAndDispatch denies consultants without dispatching", async () => {
  const fake = makeFakeDb({ selectResults: [[pendingRow]] });
  const { adapter, sent } = makeFakeAdapter({ ok: true });
  const outcome = await approveAndDispatch({
    tenantId: "tenant-1",
    messageId: "om-1",
    approvedByUserId: "consultant-1",
    approverRole: "consultant",
    adapter,
    runWithTenant: makeTenantRunner(fake.db),
  });
  assert.equal(outcome, "forbidden_role");
  assert.equal(sent.length, 0);
});

test("approveAndDispatch denies creator self-approval without dispatching", async () => {
  const fake = makeFakeDb({ selectResults: [[pendingRow]] });
  const { adapter, sent } = makeFakeAdapter({ ok: true });
  const outcome = await approveAndDispatch({
    tenantId: "tenant-1",
    messageId: "om-1",
    approvedByUserId: "creator-1",
    approverRole: "admin",
    adapter,
    runWithTenant: makeTenantRunner(fake.db),
  });
  assert.equal(outcome, "self_approval");
  assert.equal(sent.length, 0);
});

test("approveAndDispatch marks the row failed when the adapter rejects", async () => {
  const fake = makeFakeDb({ selectResults: [[pendingRow]] });
  const { adapter } = makeFakeAdapter({ ok: false, error: "boom" });
  const outcome = await approveAndDispatch({
    tenantId: "tenant-1",
    messageId: "om-1",
    approvedByUserId: "user-1",
    approverRole: "manager",
    adapter,
    runWithTenant: makeTenantRunner(fake.db),
  });
  assert.equal(outcome, "failed");
  assert.equal(fake.updates[1]?.set.status, "failed");
  assert.equal(fake.updates[1]?.set.errorDetail, "boom");
  assert.equal(
    fake.inserts.find((i) => i.table === messageDeliveries),
    undefined,
    "no delivery row is written on failure",
  );
});

test("post-provider persistence failure leaves sending without auto-retry", async () => {
  const fake = makeFakeDb({ selectResults: [[pendingRow]] });
  const { adapter, sent } = makeFakeAdapter({
    ok: true,
    providerMessageId: "provider-accepted",
  });
  let transactionCount = 0;
  const runWithTenant = async <T>(
    _tenantId: string,
    operation: (tx: DbHandle) => Promise<T>,
  ): Promise<T> => {
    transactionCount += 1;
    if (transactionCount === 2) throw new Error("database unavailable");
    return operation(fake.db);
  };
  await assert.rejects(
    approveAndDispatch({
      tenantId: "tenant-1",
      messageId: "om-1",
      approvedByUserId: "user-1",
      approverRole: "manager",
      adapter,
      runWithTenant,
    }),
    /database unavailable/,
  );
  assert.equal(sent.length, 1);
  assert.equal(fake.updates.length, 1);
  assert.equal(fake.updates[0]?.set.status, "sending");
});

test("approveAndDispatch refuses an unknown message id without dispatching", async () => {
  const fake = makeFakeDb({ selectResults: [[]] });
  const { adapter, sent } = makeFakeAdapter({ ok: true });
  const outcome = await approveAndDispatch({
    tenantId: "tenant-1",
    messageId: "missing",
    approvedByUserId: "user-1",
    approverRole: "manager",
    adapter,
    runWithTenant: makeTenantRunner(fake.db),
  });
  assert.equal(outcome, "not_found");
  assert.equal(sent.length, 0);
  assert.equal(fake.updates.length, 0);
});

test("approveAndDispatch refuses an already-handled message", async () => {
  const fake = makeFakeDb({ selectResults: [[{ ...pendingRow, status: "sent" }]] });
  const { adapter, sent } = makeFakeAdapter({ ok: true });
  const outcome = await approveAndDispatch({
    tenantId: "tenant-1",
    messageId: "om-1",
    approvedByUserId: "user-1",
    approverRole: "manager",
    adapter,
    runWithTenant: makeTenantRunner(fake.db),
  });
  assert.equal(outcome, "not_pending");
  assert.equal(sent.length, 0);
  assert.equal(fake.updates.length, 0);
});

test("approveAndDispatch emits no approval audit when CAS loses", async () => {
  const fake = makeFakeDb({
    selectResults: [[pendingRow]],
    updateReturning: [[]],
  });
  const { adapter, sent } = makeFakeAdapter({
    ok: true,
    providerMessageId: "never-sent",
  });
  const outcome = await approveAndDispatch({
    tenantId: "tenant-1",
    messageId: "om-1",
    approvedByUserId: "user-1",
    approverRole: "manager",
    adapter,
    runWithTenant: makeTenantRunner(fake.db),
  });
  assert.equal(outcome, "not_pending");
  assert.equal(sent.length, 0);
  assert.equal(
    fake.inserts.some(
      (insert) =>
        insert.table === activityLog &&
        insert.values.event === "message_approved",
    ),
    false,
  );
});

test("rejectOutboundMessage rejects a pending message with an audit event", async () => {
  const fake = makeFakeDb({ selectResults: [[pendingRow]] });
  const outcome = await rejectOutboundMessage(fake.db, {
    tenantId: "tenant-1",
    messageId: "om-1",
    rejectedByUserId: "user-1",
    rejectorRole: "manager",
    reason: "wrong recipient",
  });
  assert.equal(outcome, "rejected");
  assert.equal(fake.updates[0]?.set.status, "rejected");
  assert.equal(fake.updates[0]?.set.rejectionReason, "wrong recipient");
  const audit = fake.inserts.find((i) => i.table === activityLog);
  assert.equal(audit?.values.event, "message_rejected");
});

test("rejectOutboundMessage refuses an already-handled message", async () => {
  const fake = makeFakeDb({ selectResults: [[{ ...pendingRow, status: "sent" }]] });
  const outcome = await rejectOutboundMessage(fake.db, {
    tenantId: "tenant-1",
    messageId: "om-1",
    rejectedByUserId: "user-1",
    rejectorRole: "manager",
  });
  assert.equal(outcome, "not_pending");
  assert.equal(fake.updates.length, 0);
});

test("rejectOutboundMessage emits no terminal audit when CAS loses", async () => {
  const fake = makeFakeDb({
    selectResults: [[pendingRow], [{ ...pendingRow, status: "rejected" }]],
    updateReturning: [[]],
  });
  const outcome = await rejectOutboundMessage(fake.db, {
    tenantId: "tenant-1",
    messageId: "om-1",
    rejectedByUserId: "user-1",
    rejectorRole: "manager",
  });
  assert.equal(outcome, "not_pending");
  assert.equal(
    fake.inserts.some(
      (insert) =>
        insert.table === activityLog &&
        insert.values.event === "message_rejected",
    ),
    false,
  );
});

test("consultant cannot reject or cancel outbound messages", async () => {
  for (const action of ["reject", "cancel"] as const) {
    const fake = makeFakeDb({ selectResults: [[pendingRow]] });
    const outcome =
      action === "reject"
        ? await rejectOutboundMessage(fake.db, {
            tenantId: "tenant-1",
            messageId: "om-1",
            rejectedByUserId: "consultant-1",
            rejectorRole: "consultant",
          })
        : await cancelOutboundMessage(fake.db, {
            tenantId: "tenant-1",
            messageId: "om-1",
            cancelledByUserId: "consultant-1",
            cancellerRole: "consultant",
          });
    assert.equal(outcome, "forbidden_role");
    assert.equal(fake.updates.length, 0);
  }
});

test("cancelOutboundMessage cancels a pending or approved message", async () => {
  for (const status of ["pending_approval", "approved"] as const) {
    const fake = makeFakeDb({ selectResults: [[{ ...pendingRow, status }]] });
    const outcome = await cancelOutboundMessage(fake.db, {
      tenantId: "tenant-1",
      messageId: "om-1",
      cancelledByUserId: "user-1",
      cancellerRole: "manager",
    });
    assert.equal(outcome, "cancelled");
    assert.equal(fake.updates[0]?.set.status, "cancelled");
  }
});

test("cancelOutboundMessage refuses a message already in flight", async () => {
  const fake = makeFakeDb({ selectResults: [[{ ...pendingRow, status: "sent" }]] });
  const outcome = await cancelOutboundMessage(fake.db, {
    tenantId: "tenant-1",
    messageId: "om-1",
    cancelledByUserId: "user-1",
    cancellerRole: "manager",
  });
  assert.equal(outcome, "not_cancellable");
  assert.equal(fake.updates.length, 0);
});

test("cancelOutboundMessage emits no terminal audit when CAS loses", async () => {
  const fake = makeFakeDb({
    selectResults: [[pendingRow], [{ ...pendingRow, status: "sending" }]],
    updateReturning: [[]],
  });
  const outcome = await cancelOutboundMessage(fake.db, {
    tenantId: "tenant-1",
    messageId: "om-1",
    cancelledByUserId: "user-1",
    cancellerRole: "manager",
  });
  assert.equal(outcome, "not_cancellable");
  assert.equal(
    fake.inserts.some(
      (insert) =>
        insert.table === activityLog &&
        insert.values.event === "message_cancelled",
    ),
    false,
  );
});
