import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canApprove,
  canCancel,
  canReject,
  canTransition,
  isTerminal,
  statusForSendResult,
  type OutboundMessageStatus,
} from "@/modules/messaging/outbound-status";

test("canTransition allows the happy-path lifecycle edges", () => {
  assert.equal(canTransition("pending_approval", "approved"), true);
  assert.equal(canTransition("approved", "sending"), true);
  assert.equal(canTransition("sending", "sent"), true);
  assert.equal(canTransition("sending", "failed"), true);
  assert.equal(canTransition("sent", "delivered"), true);
});

test("canTransition allows the human decision branches", () => {
  assert.equal(canTransition("pending_approval", "rejected"), true);
  assert.equal(canTransition("pending_approval", "cancelled"), true);
  assert.equal(canTransition("approved", "cancelled"), true);
});

test("canTransition forbids skipping the approval gate", () => {
  assert.equal(canTransition("pending_approval", "sent"), false);
  assert.equal(canTransition("pending_approval", "sending"), false);
  assert.equal(canTransition("approved", "sent"), false);
});

test("canTransition forbids leaving a terminal status", () => {
  const terminals: OutboundMessageStatus[] = [
    "delivered",
    "failed",
    "rejected",
    "cancelled",
  ];
  for (const status of terminals) {
    assert.equal(canTransition(status, "sending"), false);
    assert.equal(canTransition(status, "approved"), false);
  }
});

test("canApprove / canReject only hold for a pending message", () => {
  assert.equal(canApprove("pending_approval"), true);
  assert.equal(canReject("pending_approval"), true);
  for (const status of ["approved", "sending", "sent", "rejected"] as const) {
    assert.equal(canApprove(status), false);
    assert.equal(canReject(status), false);
  }
});

test("canCancel holds for pending and approved-but-undispatched only", () => {
  assert.equal(canCancel("pending_approval"), true);
  assert.equal(canCancel("approved"), true);
  for (const status of ["sending", "sent", "delivered", "failed"] as const) {
    assert.equal(canCancel(status), false);
  }
});

test("isTerminal flags exactly the end states", () => {
  assert.equal(isTerminal("delivered"), true);
  assert.equal(isTerminal("failed"), true);
  assert.equal(isTerminal("rejected"), true);
  assert.equal(isTerminal("cancelled"), true);
  assert.equal(isTerminal("pending_approval"), false);
  assert.equal(isTerminal("sending"), false);
});

test("statusForSendResult maps ok→sent and failure→failed", () => {
  assert.equal(statusForSendResult(true), "sent");
  assert.equal(statusForSendResult(false), "failed");
});
