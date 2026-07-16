import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertAppointmentAvailability,
  assertAptitudeInviteAvailability,
} from "@/modules/participants/eligibility-gates";
import { AvailabilityGateError } from "@/modules/participants/transitions";

// W1.4: the aptitude test (invite + its appointment) sits behind the same
// 20h/6-month availability gate as the qualified/test_phase transitions.

test("aptitude invite is blocked unless availability is a clear 'yes'", () => {
  for (const availability of ["unclear", "partial", "not_possible"] as const) {
    assert.throws(
      () => assertAptitudeInviteAvailability(availability),
      AvailabilityGateError,
    );
  }
  assert.doesNotThrow(() => assertAptitudeInviteAvailability("yes"));
});

test("scheduling an aptitude_test appointment is gated", () => {
  assert.throws(
    () => assertAppointmentAvailability("aptitude_test", "unclear"),
    AvailabilityGateError,
  );
  assert.doesNotThrow(() =>
    assertAppointmentAvailability("aptitude_test", "yes"),
  );
});

test("early-funnel appointments are never gated", () => {
  for (const type of ["follow_up", "consultation"] as const) {
    for (const availability of ["unclear", "partial", "not_possible", "yes"] as const) {
      assert.doesNotThrow(() =>
        assertAppointmentAvailability(type, availability),
      );
    }
  }
});
