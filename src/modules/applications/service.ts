import { and, eq } from "drizzle-orm";
import type { DbHandle } from "@/db/client";
import { applications, participants } from "@/db/schema";
import { processTransition } from "@/modules/routing/engine";
import { changeParticipantStatus } from "@/modules/participants/transitions";
import {
  collectApplicationData,
  evaluateApplicationReadiness,
} from "@/modules/documents/data";

export type ApplicationStatus = (typeof applications.status.enumValues)[number];

// Submission workflow (concept §14). correction_required loops back to
// complete once fixed; response_pending exists in the enum for BA waiting
// states but the MVP UI treats submitted as "response pending".
const ALLOWED: Record<ApplicationStatus, ApplicationStatus[]> = {
  in_preparation: ["complete"],
  complete: ["sent_to_employer", "in_preparation"],
  sent_to_employer: ["submitted", "complete"],
  submitted: ["response_pending", "approved", "rejected", "correction_required"],
  response_pending: ["approved", "rejected", "correction_required"],
  correction_required: ["complete"],
  approved: [],
  rejected: [],
};

/** Pure predicate over the ALLOWED map — the single source of transition truth. */
export function isTransitionAllowed(
  from: ApplicationStatus,
  to: ApplicationStatus,
): boolean {
  return ALLOWED[from]?.includes(to) ?? false;
}

export class ApplicationTransitionError extends Error {
  constructor(from: string, to: string) {
    super(`Statuswechsel ${from} → ${to} ist nicht zulässig.`);
    this.name = "ApplicationTransitionError";
  }
}

// Submission readiness gate (concept §10/§14). The rule set is centralized in
// evaluateApplicationReadiness (documents/data.ts) and shared verbatim with the
// UI checklist, so the server gate and the on-screen list can never diverge.
// Blockers now include the full submission package: participant data, privacy
// consent, employer BA prerequisites (Betriebsnummer + confirmed AG-S), a
// linked measure, AND all required signatures.
export type ReadinessBlocker = {
  code: string;
  label: string;
};

export async function computeReadiness(
  tx: DbHandle,
  application: { participantId: string },
): Promise<{ ready: boolean; blockers: ReadinessBlocker[] }> {
  const data = await collectApplicationData(tx, application.participantId);
  if (!data) {
    return {
      ready: false,
      blockers: [{ code: "no_participant", label: "Teilnehmer:in nicht gefunden" }],
    };
  }
  const { ready, blockers } = evaluateApplicationReadiness(data);
  return {
    ready,
    blockers: blockers.map((b) => ({ code: b.code, label: b.label })),
  };
}

export async function changeApplicationStatus(
  tx: DbHandle,
  params: {
    applicationId: string;
    to: ApplicationStatus;
    actorKind: "internal_user" | "employer";
    actorUserId?: string;
    responseNote?: string;
  },
): Promise<void> {
  const [application] = await tx
    .select()
    .from(applications)
    .where(eq(applications.id, params.applicationId));
  if (!application) throw new Error("Application not found");
  if (application.status === params.to) return;
  if (!ALLOWED[application.status].includes(params.to)) {
    throw new ApplicationTransitionError(application.status, params.to);
  }

  // Final-checklist gate: block "complete" and "submitted" until every
  // submission blocker clears (participant data, consent, employer BA
  // prerequisites, measure, signatures). Re-checked at submit because the
  // package can change after it was first completed.
  if (params.to === "complete" || params.to === "submitted") {
    const { ready, blockers } = await computeReadiness(tx, {
      participantId: application.participantId,
    });
    if (!ready) {
      throw new ApplicationNotReadyError(blockers.map((b) => b.label));
    }
  }

  const isResponse = ["approved", "rejected", "correction_required"].includes(
    params.to,
  );
  // Atomic flip: the WHERE pins the status we validated above. A concurrent
  // transition that already moved the row gets an empty RETURNING — last
  // write does NOT win; the loser fails loudly instead of double-firing
  // routing + audit.
  const [flipped] = await tx
    .update(applications)
    .set({
      status: params.to,
      submittedAt:
        params.to === "submitted" ? new Date() : application.submittedAt,
      responseAt: isResponse ? new Date() : application.responseAt,
      responseNote: params.responseNote ?? application.responseNote,
    })
    .where(
      and(
        eq(applications.id, params.applicationId),
        eq(applications.status, application.status),
      ),
    )
    .returning({ id: applications.id });
  if (!flipped) {
    throw new ApplicationTransitionError(application.status, params.to);
  }

  const [participant] = await tx
    .select()
    .from(participants)
    .where(eq(participants.id, application.participantId));

  await processTransition(tx, {
    tenantId: application.tenantId,
    entity: "application",
    entityId: application.id,
    status: params.to,
    actorKind: params.actorKind,
    actorUserId: params.actorUserId,
    context: {
      participantId: application.participantId,
      employerId: application.employerId ?? undefined,
      consultantId:
        participant?.assignedConsultantId ?? params.actorUserId,
    },
  });

  // Approval closes the loop: the participant is enrolled. The availability
  // gate still applies — an approved application implies a confirmed "yes".
  if (params.to === "approved" && participant && params.actorUserId) {
    await changeParticipantStatus(tx, {
      participantId: participant.id,
      to: "enrolled",
      actorUserId: params.actorUserId,
      // BA approval is the definitive availability confirmation; do not let
      // the gate roll back the enrollment.
      skipAvailabilityGate: true,
      // Enrollment is an authoritative consequence of the granted application,
      // not a manual funnel step, so it bypasses the forward transition map.
      skipTransitionGuard: true,
    });
  }
}

export class ApplicationNotReadyError extends Error {
  constructor(public readonly blockerLabels: string[]) {
    super(
      `Antrag kann nicht vervollständigt werden: ${blockerLabels.join(", ")}.`,
    );
    this.name = "ApplicationNotReadyError";
  }
}
