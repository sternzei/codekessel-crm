import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildDeliveryReceiptUpdate,
  computeSessionWindowExpiry,
  mergeDeliveryStatus,
  timestampColumnFor,
} from "@/modules/messaging/delivery-status";

// --- monotonic status merge ------------------------------------------------

test("mergeDeliveryStatus advances along sent -> delivered -> read", () => {
  assert.equal(mergeDeliveryStatus("sent", "delivered"), "delivered");
  assert.equal(mergeDeliveryStatus("delivered", "read"), "read");
  assert.equal(mergeDeliveryStatus("sent", "read"), "read");
});

test("mergeDeliveryStatus never regresses on a late/duplicate receipt", () => {
  assert.equal(mergeDeliveryStatus("read", "delivered"), "read");
  assert.equal(mergeDeliveryStatus("delivered", "sent"), "delivered");
  assert.equal(mergeDeliveryStatus("read", "read"), "read");
});

test("failed outranks sent but never downgrades a delivered/read message", () => {
  assert.equal(mergeDeliveryStatus("sent", "failed"), "failed");
  assert.equal(mergeDeliveryStatus("delivered", "failed"), "delivered");
  assert.equal(mergeDeliveryStatus("read", "failed"), "read");
  // A stuck 'failed' can still be superseded by a real delivery.
  assert.equal(mergeDeliveryStatus("failed", "delivered"), "delivered");
});

// --- timestamp projection --------------------------------------------------

test("timestampColumnFor maps each status to its own column", () => {
  assert.equal(timestampColumnFor("sent"), "sentAt");
  assert.equal(timestampColumnFor("delivered"), "deliveredAt");
  assert.equal(timestampColumnFor("read"), "readAt");
  assert.equal(timestampColumnFor("failed"), "failedAt");
});

// --- receipt → column update -----------------------------------------------

test("buildDeliveryReceiptUpdate stamps the incoming timestamp and merges status", () => {
  const at = new Date("2026-01-01T10:00:00Z");
  const update = buildDeliveryReceiptUpdate("sent", {
    status: "delivered",
    occurredAt: at,
  });
  assert.equal(update.status, "delivered");
  assert.deepEqual(update.deliveredAt, at);
  assert.equal(update.errorDetail, undefined);
});

test("buildDeliveryReceiptUpdate records the failure detail on a failed receipt", () => {
  const at = new Date("2026-01-01T10:00:00Z");
  const update = buildDeliveryReceiptUpdate("sent", {
    status: "failed",
    occurredAt: at,
    errorTitle: "Re-engagement message",
  });
  assert.equal(update.status, "failed");
  assert.deepEqual(update.failedAt, at);
  assert.equal(update.errorDetail, "Re-engagement message");
});

test("buildDeliveryReceiptUpdate stamps a late milestone without regressing status", () => {
  const at = new Date("2026-01-01T10:05:00Z");
  // A delivered receipt arriving after read: status stays read, deliveredAt set.
  const update = buildDeliveryReceiptUpdate("read", {
    status: "delivered",
    occurredAt: at,
  });
  assert.equal(update.status, "read");
  assert.deepEqual(update.deliveredAt, at);
});

// --- 24h session window ----------------------------------------------------

test("computeSessionWindowExpiry is exactly 24h after the inbound message", () => {
  const inbound = new Date("2026-01-01T10:00:00Z");
  assert.deepEqual(
    computeSessionWindowExpiry(inbound),
    new Date("2026-01-02T10:00:00Z"),
  );
});
