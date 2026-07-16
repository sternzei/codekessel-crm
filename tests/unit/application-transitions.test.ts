import { test } from "node:test";
import assert from "node:assert/strict";
import { isTransitionAllowed } from "@/modules/applications/service";

// Submission workflow state machine (concept §14).

test("valid forward transitions are allowed", () => {
  assert.ok(isTransitionAllowed("in_preparation", "complete"));
  assert.ok(isTransitionAllowed("complete", "sent_to_employer"));
  assert.ok(isTransitionAllowed("sent_to_employer", "submitted"));
  assert.ok(isTransitionAllowed("submitted", "approved"));
  assert.ok(isTransitionAllowed("submitted", "rejected"));
  assert.ok(isTransitionAllowed("submitted", "correction_required"));
});

test("correction loops back to complete", () => {
  assert.ok(isTransitionAllowed("correction_required", "complete"));
});

test("terminal states allow no further transitions", () => {
  assert.equal(isTransitionAllowed("approved", "complete"), false);
  assert.equal(isTransitionAllowed("approved", "submitted"), false);
  assert.equal(isTransitionAllowed("rejected", "complete"), false);
});

test("illegal skips are rejected", () => {
  assert.equal(isTransitionAllowed("in_preparation", "submitted"), false);
  assert.equal(isTransitionAllowed("in_preparation", "approved"), false);
  assert.equal(isTransitionAllowed("complete", "approved"), false);
  assert.equal(isTransitionAllowed("sent_to_employer", "approved"), false);
});
