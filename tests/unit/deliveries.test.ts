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

// Control-flow tests against a lightweight drizzle-shaped fake (no database) —
// the pure status logic itself is covered in delivery-status.test.ts.

type Row = Record<string, unknown>;

type FakeConfig = {
  // Rows returned by select().from().where() (the delivery lookup).
  selectResults?: Row[][];
  // Rows returned by update().set().where().returning() (inbound window bump).
  updateReturning?: Row[];
};

function makeFakeDb(config: FakeConfig = {}) {
  const inserts: { table: unknown; values: Row }[] = [];
  const updates: { table: unknown; set: Row }[] = [];
  let selectIndex = 0;
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
            where() {
              updates.push({ table, set });
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

test("applyInboundReceipt reopens the participant window when the phone matches", async () => {
  const fake = makeFakeDb({ updateReturning: [{ id: "p1" }] });
  const applied = await applyInboundReceipt(fake.db, inboundEvent);
  assert.equal(applied, true);
  const update = fake.updates.find((u) => u.table === participants);
  assert.ok(update, "the participant window is updated");
  assert.ok(update?.set.whatsappWindowExpiresAt instanceof Date);
});

test("applyInboundReceipt is a no-op when no participant matches the number", async () => {
  const fake = makeFakeDb({ updateReturning: [] });
  const applied = await applyInboundReceipt(fake.db, inboundEvent);
  assert.equal(applied, false);
});

test("reconcileDeliveryEvents tallies applied status + inbound events", async () => {
  const fake = makeFakeDb({
    selectResults: [[{ id: "d1", status: "sent" }]],
    updateReturning: [{ id: "p1" }],
  });
  const result = await reconcileDeliveryEvents(fake.db, [statusEvent, inboundEvent]);
  assert.deepEqual(result, { statusApplied: 1, inboundApplied: 1 });
});
