import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canApproveCloudMessage,
  canAssignParticipant,
  canAccessParticipant,
  getParticipantWriteDecision,
  getTaskWriteDecision,
  normalizeParticipantFilter,
  type ParticipantAccessContext,
} from "@/modules/auth/authorization";

const consultant: ParticipantAccessContext = {
  userId: "consultant-1",
  role: "consultant",
};

test("consultant can access own and unassigned participants only", () => {
  assert.equal(canAccessParticipant(consultant, "consultant-1"), true);
  assert.equal(canAccessParticipant(consultant, null), true);
  assert.equal(canAccessParticipant(consultant, "consultant-2"), false);
});

test("manager and admin can access every tenant participant", () => {
  for (const role of ["manager", "admin"] as const) {
    const context: ParticipantAccessContext = { userId: `${role}-1`, role };
    assert.equal(canAccessParticipant(context, "consultant-2"), true);
    assert.equal(canAccessParticipant(context, null), true);
  }
});

test("consultant query parameters cannot widen participant scope", () => {
  assert.deepEqual(
    normalizeParticipantFilter(
      { statuses: [], consultantId: "consultant-2" },
      consultant,
    ),
    { statuses: [] },
  );
  assert.deepEqual(
    normalizeParticipantFilter({ statuses: [], unassigned: true }, consultant),
    { statuses: [], unassigned: true },
  );
});

test("normalizeParticipantFilter never shares mutable status arrays", () => {
  const statuses = ["new"] as const;
  const input = { statuses: [...statuses], consultantId: "consultant-2" };
  const normalized = normalizeParticipantFilter(input, consultant);
  normalized.statuses.push("called");
  assert.deepEqual(input.statuses, ["new"]);
});

test("consultant must claim a pool participant before writing", () => {
  assert.equal(getParticipantWriteDecision(consultant, null), "must_claim");
  assert.equal(
    getParticipantWriteDecision(consultant, "consultant-1"),
    "allowed",
  );
  assert.equal(
    getParticipantWriteDecision(consultant, "consultant-2"),
    "forbidden",
  );
});

test("participant-owned pool tasks require claim before mutation", () => {
  assert.equal(
    getTaskWriteDecision({
      context: consultant,
      ownerUserId: null,
      participantAssignedConsultantId: null,
      hasParticipantOwner: true,
    }),
    "must_claim",
  );
  assert.equal(
    getTaskWriteDecision({
      context: consultant,
      ownerUserId: null,
      participantAssignedConsultantId: "consultant-1",
      hasParticipantOwner: true,
    }),
    "allowed",
  );
});

test("manager and admin may mutate pool participants and tasks", () => {
  for (const role of ["manager", "admin"] as const) {
    const context = { userId: role, role };
    assert.equal(getParticipantWriteDecision(context, null), "allowed");
    assert.equal(
      getTaskWriteDecision({
        context,
        ownerUserId: null,
        participantAssignedConsultantId: null,
        hasParticipantOwner: true,
      }),
      "allowed",
    );
  }
});

test("consultants may claim pool records but cannot reassign records", () => {
  assert.equal(canAssignParticipant(consultant, null, "consultant-1"), true);
  assert.equal(
    canAssignParticipant(consultant, "consultant-1", "consultant-2"),
    false,
  );
  assert.equal(
    canAssignParticipant(consultant, "consultant-2", "consultant-1"),
    false,
  );
});

test("manager and admin may assign or reassign within their tenant", () => {
  for (const role of ["manager", "admin"] as const) {
    const context: ParticipantAccessContext = { userId: `${role}-1`, role };
    assert.equal(
      canAssignParticipant(context, "consultant-1", "consultant-2"),
      true,
    );
  }
});

test("only manager or admin may approve and creators cannot self-approve", () => {
  assert.equal(
    canApproveCloudMessage({
      approver: consultant,
      createdByUserId: "consultant-2",
    }),
    "forbidden_role",
  );
  assert.equal(
    canApproveCloudMessage({
      approver: { userId: "manager-1", role: "manager" },
      createdByUserId: "manager-1",
    }),
    "self_approval",
  );
  assert.equal(
    canApproveCloudMessage({
      approver: { userId: "manager-1", role: "manager" },
      createdByUserId: null,
    }),
    "allowed",
  );
});
