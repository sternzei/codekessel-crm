import { eq } from "drizzle-orm";
import type { DbHandle } from "@/db/client";
import { participants } from "@/db/schema";
import { processTransition } from "@/modules/routing/engine";

export type ParticipantStatus =
  (typeof participants.status.enumValues)[number];
export type AvailabilityStatus =
  (typeof participants.availabilityStatus.enumValues)[number];

// Statuses past the qualification gate: entering them requires the
// 20h/week × 6 months availability to be a clear "yes". This is the
// concept's mandatory checkpoint — the funnel fails late without it.
const GATED_STATUSES: ReadonlySet<ParticipantStatus> = new Set([
  "qualified",
  "test_phase",
  "documents_phase",
  "application_phase",
  "enrolled",
]);

export class AvailabilityGateError extends Error {
  constructor() {
    super(
      "Verfügbarkeit nicht bestätigt: 20 Stunden/Woche über 6 Monate müssen eindeutig mit „Ja“ bestätigt sein, bevor der Lead qualifiziert werden kann.",
    );
    this.name = "AvailabilityGateError";
  }
}

export function assertAvailabilityGate(
  to: ParticipantStatus,
  availability: AvailabilityStatus,
): void {
  if (GATED_STATUSES.has(to) && availability !== "yes") {
    throw new AvailabilityGateError();
  }
}

export type ChangeStatusParams = {
  participantId: string;
  to: ParticipantStatus;
  actorUserId: string;
  /**
   * Bypass the 20h/6-month gate. Only the BA-approval → enrolled path sets
   * this: a granted application is itself the definitive confirmation of
   * availability, so re-checking the recorded answer would wrongly roll back
   * the approval when the answer was never explicitly stamped "yes".
   */
  skipAvailabilityGate?: boolean;
};

/**
 * The only way participant status changes: gate check → update →
 * routing engine. Throws AvailabilityGateError when the 20h/6-month
 * gate blocks the transition.
 */
export async function changeParticipantStatus(
  tx: DbHandle,
  params: ChangeStatusParams,
): Promise<void> {
  const [participant] = await tx
    .select()
    .from(participants)
    .where(eq(participants.id, params.participantId));
  if (!participant) throw new Error("Participant not found");
  if (participant.status === params.to) return;

  if (!params.skipAvailabilityGate) {
    assertAvailabilityGate(params.to, participant.availabilityStatus);
  }

  await tx
    .update(participants)
    .set({ status: params.to })
    .where(eq(participants.id, participant.id));

  await processTransition(tx, {
    tenantId: participant.tenantId,
    entity: "participant",
    entityId: participant.id,
    status: params.to,
    actorKind: "internal_user",
    actorUserId: params.actorUserId,
    context: {
      participantId: participant.id,
      employerId: participant.employerId ?? undefined,
      consultantId:
        participant.assignedConsultantId ?? params.actorUserId,
    },
  });
}

/**
 * Records an availability answer (from the call script or a magic-link
 * task) and pushes the `availability_<answer>` transition through the
 * rules engine.
 */
export async function recordAvailability(
  tx: DbHandle,
  params: {
    participantId: string;
    availability: AvailabilityStatus;
    actorKind: "internal_user" | "participant";
    actorUserId?: string;
  },
): Promise<void> {
  const [participant] = await tx
    .select()
    .from(participants)
    .where(eq(participants.id, params.participantId));
  if (!participant) throw new Error("Participant not found");

  await tx
    .update(participants)
    .set({ availabilityStatus: params.availability })
    .where(eq(participants.id, participant.id));

  await processTransition(tx, {
    tenantId: participant.tenantId,
    entity: "participant",
    entityId: participant.id,
    status: `availability_${params.availability}`,
    actorKind: params.actorKind,
    actorUserId: params.actorUserId,
    context: {
      participantId: participant.id,
      employerId: participant.employerId ?? undefined,
      consultantId: participant.assignedConsultantId ?? undefined,
    },
  });
}
