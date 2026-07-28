import { test } from "node:test";
import assert from "node:assert/strict";
import type { DbHandle } from "@/db/client";
import { activityLog, messageDeliveries, outboundMessages } from "@/db/schema";
import {
  approveAndDispatch,
  cancelOutboundMessage,
  enqueueTaskMessage,
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
};

function makeFakeDb(config: FakeConfig = {}) {
  const inserts: { table: unknown; values: Row }[] = [];
  const updates: { table: unknown; set: Row }[] = [];
  const selectQueue = [...(config.selectResults ?? [])];
  const nextSelect = (): Row[] => selectQueue.shift() ?? [];
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
              return Promise.resolve(undefined);
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
  const outcome = await approveAndDispatch(fake.db, {
    tenantId: "tenant-1",
    messageId: "om-1",
    approvedByUserId: "user-1",
    adapter,
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

test("approveAndDispatch marks the row failed when the adapter rejects", async () => {
  const fake = makeFakeDb({ selectResults: [[pendingRow]] });
  const { adapter } = makeFakeAdapter({ ok: false, error: "boom" });
  const outcome = await approveAndDispatch(fake.db, {
    tenantId: "tenant-1",
    messageId: "om-1",
    approvedByUserId: "user-1",
    adapter,
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

test("approveAndDispatch refuses an unknown message id without dispatching", async () => {
  const fake = makeFakeDb({ selectResults: [[]] });
  const { adapter, sent } = makeFakeAdapter({ ok: true });
  const outcome = await approveAndDispatch(fake.db, {
    tenantId: "tenant-1",
    messageId: "missing",
    approvedByUserId: "user-1",
    adapter,
  });
  assert.equal(outcome, "not_found");
  assert.equal(sent.length, 0);
  assert.equal(fake.updates.length, 0);
});

test("approveAndDispatch refuses an already-handled message", async () => {
  const fake = makeFakeDb({ selectResults: [[{ ...pendingRow, status: "sent" }]] });
  const { adapter, sent } = makeFakeAdapter({ ok: true });
  const outcome = await approveAndDispatch(fake.db, {
    tenantId: "tenant-1",
    messageId: "om-1",
    approvedByUserId: "user-1",
    adapter,
  });
  assert.equal(outcome, "not_pending");
  assert.equal(sent.length, 0);
  assert.equal(fake.updates.length, 0);
});

test("rejectOutboundMessage rejects a pending message with an audit event", async () => {
  const fake = makeFakeDb({ selectResults: [[pendingRow]] });
  const outcome = await rejectOutboundMessage(fake.db, {
    tenantId: "tenant-1",
    messageId: "om-1",
    rejectedByUserId: "user-1",
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
  });
  assert.equal(outcome, "not_pending");
  assert.equal(fake.updates.length, 0);
});

test("cancelOutboundMessage cancels a pending or approved message", async () => {
  for (const status of ["pending_approval", "approved"] as const) {
    const fake = makeFakeDb({ selectResults: [[{ ...pendingRow, status }]] });
    const outcome = await cancelOutboundMessage(fake.db, {
      tenantId: "tenant-1",
      messageId: "om-1",
      cancelledByUserId: "user-1",
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
  });
  assert.equal(outcome, "not_cancellable");
  assert.equal(fake.updates.length, 0);
});
