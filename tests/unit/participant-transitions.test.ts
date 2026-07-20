import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALLOWED_PARTICIPANT_TRANSITIONS,
  ParticipantTransitionError,
  isParticipantTransitionAllowed,
} from "@/modules/participants/status-machine";
import { PIPELINE_STATUS_ORDER } from "@/modules/participants/queries";

// Guarded lead status state-machine (Epic F.2). The map is the single source
// of transition truth; the availability gate is enforced on top of it.

test("no-op transitions (from === to) are always allowed", () => {
  for (const status of PIPELINE_STATUS_ORDER) {
    assert.ok(isParticipantTransitionAllowed(status, status));
  }
});

test("early-funnel contact outcomes are mutually reachable", () => {
  const early = [
    "new",
    "called",
    "not_reachable",
    "wrong_number",
    "interested",
    "not_interested",
    "eligibility_unclear",
  ] as const;
  for (const from of early) {
    for (const to of early) {
      assert.ok(
        isParticipantTransitionAllowed(from, to),
        `${from} → ${to} should be allowed`,
      );
    }
  }
});

test("phase chain only advances one step at a time", () => {
  assert.ok(isParticipantTransitionAllowed("qualified", "test_phase"));
  assert.ok(isParticipantTransitionAllowed("test_phase", "documents_phase"));
  assert.ok(
    isParticipantTransitionAllowed("documents_phase", "application_phase"),
  );
  assert.ok(isParticipantTransitionAllowed("application_phase", "enrolled"));
});

test("phase skips are rejected", () => {
  assert.equal(isParticipantTransitionAllowed("qualified", "documents_phase"), false);
  assert.equal(isParticipantTransitionAllowed("qualified", "enrolled"), false);
  assert.equal(
    isParticipantTransitionAllowed("test_phase", "application_phase"),
    false,
  );
  assert.equal(isParticipantTransitionAllowed("new", "enrolled"), false);
  assert.equal(isParticipantTransitionAllowed("new", "test_phase"), false);
});

test("qualified is reachable from the early funnel and employer check", () => {
  assert.ok(isParticipantTransitionAllowed("interested", "qualified"));
  assert.ok(isParticipantTransitionAllowed("employer_pending", "qualified"));
});

test("lost is an escape hatch from every non-terminal status", () => {
  for (const status of PIPELINE_STATUS_ORDER) {
    if (status === "lost") continue;
    assert.ok(
      isParticipantTransitionAllowed(status, "lost"),
      `${status} → lost should be allowed`,
    );
  }
});

test("terminal states allow no forward transition", () => {
  // lost has no outgoing edges; enrolled only drops out to lost.
  assert.equal(ALLOWED_PARTICIPANT_TRANSITIONS.lost.size, 0);
  assert.deepEqual([...ALLOWED_PARTICIPANT_TRANSITIONS.enrolled], ["lost"]);
});

test("ParticipantTransitionError carries the offending states", () => {
  const error = new ParticipantTransitionError("new", "enrolled");
  assert.equal(error.name, "ParticipantTransitionError");
  assert.equal(error.from, "new");
  assert.equal(error.to, "enrolled");
});
