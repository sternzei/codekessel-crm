import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AvailabilityGateError,
  assertAvailabilityGate,
} from "@/modules/participants/transitions";

// The 20h/6-month gate is the concept's mandatory checkpoint: no participant
// enters a post-qualification status without a clear "yes".

test("gated statuses require availability === 'yes'", () => {
  for (const status of [
    "qualified",
    "test_phase",
    "documents_phase",
    "application_phase",
    "enrolled",
  ] as const) {
    assert.throws(() => assertAvailabilityGate(status, "unclear"), AvailabilityGateError);
    assert.throws(() => assertAvailabilityGate(status, "partial"), AvailabilityGateError);
    assert.throws(() => assertAvailabilityGate(status, "not_possible"), AvailabilityGateError);
    assert.doesNotThrow(() => assertAvailabilityGate(status, "yes"));
  }
});

test("pre-gate statuses are never blocked, regardless of availability", () => {
  for (const status of [
    "new",
    "called",
    "not_reachable",
    "interested",
    "employer_pending",
  ] as const) {
    assert.doesNotThrow(() => assertAvailabilityGate(status, "unclear"));
    assert.doesNotThrow(() => assertAvailabilityGate(status, "not_possible"));
  }
});
