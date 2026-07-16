import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hasDuplicateActiveTask,
  type ActiveTaskRow,
} from "@/modules/routing/engine";

// W1.2: a routing transition must never stack a second *active* task with the
// same (type, owner, subject). Subject is scoped by the caller's query, so the
// shared rule below decides on type + owner_kind + resolved owner id.

const participantTask = (
  over: Partial<ActiveTaskRow> = {},
): ActiveTaskRow => ({
  type: "confirm_availability",
  ownerKind: "participant",
  ownerParticipantId: "p-1",
  ownerEmployerId: null,
  ownerUserId: null,
  status: "open",
  ...over,
});

test("treats an existing active task for the same owner+type as a duplicate", () => {
  assert.equal(
    hasDuplicateActiveTask(
      {
        type: "confirm_availability",
        ownerKind: "participant",
        owner: { ownerParticipantId: "p-1" },
      },
      [participantTask()],
    ),
    true,
  );
});

test("a different owner id is not a duplicate", () => {
  assert.equal(
    hasDuplicateActiveTask(
      {
        type: "confirm_availability",
        ownerKind: "participant",
        owner: { ownerParticipantId: "p-2" },
      },
      [participantTask({ ownerParticipantId: "p-1" })],
    ),
    false,
  );
});

test("a different task type is not a duplicate", () => {
  assert.equal(
    hasDuplicateActiveTask(
      {
        type: "collect_documents",
        ownerKind: "participant",
        owner: { ownerParticipantId: "p-1" },
      },
      [participantTask({ type: "confirm_availability" })],
    ),
    false,
  );
});

test("a different owner kind is not a duplicate", () => {
  assert.equal(
    hasDuplicateActiveTask(
      {
        type: "confirm_availability",
        ownerKind: "employer",
        owner: { ownerEmployerId: "e-1" },
      },
      [participantTask()],
    ),
    false,
  );
});

test("completed/cancelled tasks do not block a fresh one", () => {
  for (const status of ["done", "cancelled", "escalated"]) {
    assert.equal(
      hasDuplicateActiveTask(
        {
          type: "confirm_availability",
          ownerKind: "participant",
          owner: { ownerParticipantId: "p-1" },
        },
        [participantTask({ status })],
      ),
      false,
    );
  }
});

test("matches employer- and internal-user-owned tasks on the right column", () => {
  assert.equal(
    hasDuplicateActiveTask(
      {
        type: "employer_setup",
        ownerKind: "employer",
        owner: { ownerEmployerId: "e-9" },
      },
      [
        {
          type: "employer_setup",
          ownerKind: "employer",
          ownerParticipantId: null,
          ownerEmployerId: "e-9",
          ownerUserId: null,
          status: "waiting",
        },
      ],
    ),
    true,
  );
  assert.equal(
    hasDuplicateActiveTask(
      {
        type: "reminder_call",
        ownerKind: "internal_user",
        owner: { ownerUserId: "u-3" },
      },
      [
        {
          type: "reminder_call",
          ownerKind: "internal_user",
          ownerParticipantId: null,
          ownerEmployerId: null,
          ownerUserId: "u-3",
          status: "in_progress",
        },
      ],
    ),
    true,
  );
});

test("an unresolved owner is never a duplicate", () => {
  assert.equal(
    hasDuplicateActiveTask(
      { type: "confirm_availability", ownerKind: "participant", owner: {} },
      [participantTask()],
    ),
    false,
  );
});
