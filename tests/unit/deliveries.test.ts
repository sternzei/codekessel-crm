import { test } from "node:test";
import assert from "node:assert/strict";
import type { DbHandle } from "@/db/client";
import { messageDeliveries, participants } from "@/db/schema";
import {
  applyInboundReceipt,
  applyStatusReceipt,
  reconcileDeliveryEvents,
} from "@/modules/messaging/deliveries";
import type {
  WhatsAppInboundEvent,
  WhatsAppStatusEvent,
} from "@/modules/messaging/whatsapp-webhook";
import { normalizePhone } from "@/modules/participants/phone";

// Control-flow tests against a lightweight drizzle-shaped fake (no database) —
// the pure status logic itself is covered in delivery-status.test.ts.

type Row = Record<string, unknown>;

type FakeConfig = {
  // Rows returned, in order, by each select() query (delivery lookup, then the
  // inbound owner lookup).
  selectResults?: Row[][];
  // Rows returned by update().set().where().returning() (inbound window bump).
  updateReturning?: Row[];
};

// Walks a drizzle SQL predicate and collects its bound string parameters, so a
// test can assert exactly which values an UPDATE ... WHERE was scoped to.
function boundValues(node: unknown, acc: string[] = []): string[] {
  if (!node || typeof node !== "object") return acc;
  const record = node as Record<string, unknown>;
  if (typeof record.value === "string") acc.push(record.value);
  const chunks = record.queryChunks;
  if (Array.isArray(chunks)) chunks.forEach((chunk) => boundValues(chunk, acc));
  else if (Array.isArray(node)) (node as unknown[]).forEach((chunk) => boundValues(chunk, acc));
  return acc;
}

function makeFakeDb(config: FakeConfig = {}) {
  const inserts: { table: unknown; values: Row }[] = [];
  const updates: { table: unknown; set: Row; where: unknown }[] = [];
  let selectIndex = 0;
  // A chainable, awaitable select builder: from/innerJoin/where/orderBy/limit
  // all return the same builder, and awaiting it yields the next configured
  // result set.
  function selectBuilder() {
    const result = Promise.resolve(config.selectResults?.[selectIndex++] ?? []);
    const builder: Record<string, unknown> = {};
    for (const method of ["from", "innerJoin", "leftJoin", "where", "orderBy", "limit"]) {
      builder[method] = () => builder;
    }
    builder.then = (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
      result.then(onFulfilled, onRejected);
    return builder;
  }
  const db = {
    insert(table: unknown) {
      return {
        values(values: Row) {
          inserts.push({ table, values });
          return Promise.resolve(undefined);
        },
      };
    },
    update(table: unknown) {
      return {
        set(set: Row) {
          return {
            where(where: unknown) {
              updates.push({ table, set, where });
              return {
                returning() {
                  return Promise.resolve(config.updateReturning ?? []);
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
      return selectBuilder();
    },
  };
  return { db: db as unknown as DbHandle, inserts, updates };
}

const statusEvent: WhatsAppStatusEvent = {
  kind: "status",
  providerMessageId: "wamid.ABC",
  status: "delivered",
  recipientPhone: "491511234567",
  occurredAt: new Date("2026-01-01T10:00:00Z"),
  errorTitle: null,
};

test("applyStatusReceipt updates a known delivery row", async () => {
  const fake = makeFakeDb({ selectResults: [[{ id: "d1", status: "sent" }]] });
  const applied = await applyStatusReceipt(fake.db, statusEvent);
  assert.equal(applied, true);
  const update = fake.updates.find((u) => u.table === messageDeliveries);
  assert.ok(update, "the delivery row is updated");
  assert.equal(update?.set.status, "delivered");
  assert.deepEqual(update?.set.deliveredAt, statusEvent.occurredAt);
});

test("applyStatusReceipt ignores an unknown provider message id", async () => {
  const fake = makeFakeDb({ selectResults: [[]] });
  const applied = await applyStatusReceipt(fake.db, statusEvent);
  assert.equal(applied, false);
  assert.equal(fake.updates.length, 0);
});

const inboundEvent: WhatsAppInboundEvent = {
  kind: "inbound",
  providerMessageId: "wamid.IN",
  fromPhone: "491511234567",
  occurredAt: new Date("2026-01-01T10:00:00Z"),
  text: "Ja",
};

test("applyInboundReceipt reopens the window for the tenant that messaged the number", async () => {
  const fake = makeFakeDb({
    // The owner lookup (message_deliveries ⨝ participants) resolves the tenant.
    selectResults: [[{ tenantId: "tenant-A", participantId: "participant-A" }]],
    updateReturning: [{ id: "participant-A" }],
  });
  const applied = await applyInboundReceipt(fake.db, inboundEvent);
  assert.equal(applied, true);
  const update = fake.updates.find((u) => u.table === participants);
  assert.ok(update, "the participant window is updated");
  assert.ok(update?.set.whatsappWindowExpiresAt instanceof Date);
});

test("applyInboundReceipt fails closed when no owning tenant can be resolved", async () => {
  // We never sent this number an outbound message → owner lookup is empty.
  const fake = makeFakeDb({ selectResults: [[]], updateReturning: [] });
  const applied = await applyInboundReceipt(fake.db, inboundEvent);
  assert.equal(applied, false);
  // Crucially: NO participant update at all (the old code did a blanket
  // phone-keyed update on the RLS-bypassing owner connection).
  assert.equal(fake.updates.length, 0, "no cross-tenant write is attempted");
});

test("applyInboundReceipt scopes the update to the resolved (tenant, participant) — a reply for tenant A never touches tenant B", async () => {
  // Both tenant A and tenant B have a participant with this exact phone, but
  // only tenant A ever messaged it, so the owner lookup resolves tenant A.
  const fake = makeFakeDb({
    selectResults: [[{ tenantId: "tenant-A", participantId: "participant-A" }]],
    updateReturning: [{ id: "participant-A" }],
  });
  await applyInboundReceipt(fake.db, inboundEvent);
  const update = fake.updates.find((u) => u.table === participants);
  assert.ok(update, "the participant window is updated");
  const scopedTo = boundValues(update?.where);
  assert.ok(scopedTo.includes("participant-A"), "scoped to tenant A's participant");
  assert.ok(scopedTo.includes("tenant-A"), "scoped to the owning tenant");
  assert.ok(
    !scopedTo.includes("participant-B"),
    "tenant B's same-phone participant is never in the update predicate",
  );
  // And the update is NOT keyed on the raw phone number anymore.
  const normalizedPhone = normalizePhone({ raw: inboundEvent.fromPhone }).normalized ?? "";
  assert.ok(!scopedTo.includes(normalizedPhone), "not keyed on the phone number");
});

test("reconcileDeliveryEvents tallies applied status + inbound events", async () => {
  const fake = makeFakeDb({
    // select #1: status delivery lookup; select #2: inbound owner lookup.
    selectResults: [
      [{ id: "d1", status: "sent" }],
      [{ tenantId: "tenant-A", participantId: "participant-A" }],
    ],
    updateReturning: [{ id: "participant-A" }],
  });
  const result = await reconcileDeliveryEvents(fake.db, [statusEvent, inboundEvent]);
  assert.deepEqual(result, { statusApplied: 1, inboundApplied: 1 });
});
