import { eq } from "drizzle-orm";
import type { DbHandle } from "@/db/client";
import { applications, employers, participants } from "@/db/schema";
import { processTransition } from "@/modules/routing/engine";
import { changeParticipantStatus } from "@/modules/participants/transitions";

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

// Submission readiness gate (concept §10/§14): an application cannot be
// marked complete until the structural BA requirements are met — a linked
// employer with a Betriebsnummer, a confirmed AG-S status, and a linked
// measure. Document/signature/availability completeness is surfaced by the
// documents checklist (Phase 5); these are the hard blockers that would make
// a real submission package impossible.
export type ReadinessBlocker = {
  code: string;
  label: string;
};

export async function computeReadiness(
  tx: DbHandle,
  application: { employerId: string | null; measureId: string | null },
): Promise<{ ready: boolean; blockers: ReadinessBlocker[] }> {
  const blockers: ReadinessBlocker[] = [];

  if (!application.employerId) {
    blockers.push({ code: "no_employer", label: "Kein Arbeitgeber verknüpft" });
  } else {
    const [employer] = await tx
      .select()
      .from(employers)
      .where(eq(employers.id, application.employerId));
    if (!employer?.betriebsnummer) {
      blockers.push({
        code: "betriebsnummer_missing",
        label: "Betriebsnummer fehlt",
      });
    }
    if (employer?.agsRegistered === false || employer?.agsRegistered === null) {
      blockers.push({
        code: "ags_unconfirmed",
        label: "Arbeitgeberservice-Status nicht bestätigt",
      });
    }
  }

  if (!application.measureId) {
    blockers.push({ code: "no_measure", label: "Keine Maßnahme zugeordnet" });
  }

  return { ready: blockers.length === 0, blockers };
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

  // Final-checklist gate: block "complete" until structural blockers clear.
  if (params.to === "complete") {
    const { ready, blockers } = await computeReadiness(tx, application);
    if (!ready) {
      throw new ApplicationNotReadyError(blockers.map((b) => b.label));
    }
  }

  const isResponse = ["approved", "rejected", "correction_required"].includes(
    params.to,
  );
  await tx
    .update(applications)
    .set({
      status: params.to,
      submittedAt:
        params.to === "submitted" ? new Date() : application.submittedAt,
      responseAt: isResponse ? new Date() : application.responseAt,
      responseNote: params.responseNote ?? application.responseNote,
    })
    .where(eq(applications.id, params.applicationId));

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
