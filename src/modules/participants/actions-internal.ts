"use server";

import { and, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { withTenant, type Tx } from "@/db/client";
import {
  activityLog,
  appointments,
  aptitudeTests,
  contactNotes,
  participants,
  reminderJobs,
  tasks,
  users,
} from "@/db/schema";
import { logActivity } from "@/modules/audit/log";
import { canManageTenantRecords } from "@/modules/auth/authorization";
import { resolveParticipantWriteAccess } from "@/modules/auth/participant-scope";
import { resolveTaskWriteAccess } from "@/modules/auth/task-scope";
import { getSession, type SessionUser } from "@/modules/auth/session";
import { processTransition } from "@/modules/routing/engine";
import { resolveAptitudeTestUrl } from "@/modules/aptitude-tests/config";
import {
  assertAppointmentAvailability,
  assertAptitudeInviteAvailability,
} from "@/modules/participants/eligibility-gates";
import { normalizePhone } from "@/modules/participants/phone";
import {
  AvailabilityGateError,
  changeParticipantStatus,
  recordAvailability,
} from "@/modules/participants/transitions";
import { ParticipantTransitionError } from "@/modules/participants/status-machine";
import { ACTIVE_TASK_STATUSES } from "@/modules/tasks/status";
import { getOrIssueMagicLinkForTask } from "@/modules/tokens/service";
import {
  isValidBic,
  isValidIban,
  isValidSvNumber,
  normalizeBic,
  normalizeIban,
  normalizeSvNumber,
  parseDecimalString,
  parseFundingStatus,
  parseQualificationHistory,
  parseSalaryComponents,
  parseWeeklyTimes,
} from "@/lib/ba-format";

// All internal (console) server actions. Every action re-checks the session —
// the layout guard alone is not an authorization boundary.

async function requireSession(): Promise<SessionUser> {
  const session = await getSession();
  if (!session) redirect("/auth/sign-in");
  return session;
}

function leadPath(id: string): string {
  return `/leads/${id}`;
}

const requireLeadWrite = async (
  tx: Tx,
  session: SessionUser,
  participantId: string,
): Promise<void> => {
  const decision = await resolveParticipantWriteAccess(tx, participantId, {
    userId: session.id,
    role: session.role,
  });
  if (decision !== "allowed") {
    redirect(`${leadPath(participantId)}?access=${decision}`);
  }
};

// ---------------------------------------------------------------------------
// Lead creation
// ---------------------------------------------------------------------------

const createLeadSchema = z.object({
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  email: z.string().trim().email().optional().or(z.literal("")),
  phone: z.string().trim().optional(),
  city: z.string().trim().optional(),
  source: z.string().trim().optional(),
});

export async function createLead(formData: FormData): Promise<void> {
  const session = await requireSession();
  const parsed = createLeadSchema.safeParse({
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    city: formData.get("city"),
    source: formData.get("source"),
  });
  if (!parsed.success) redirect("/leads/new?error=1");

  const phone = parsed.data.phone || null;
  const leadId = await withTenant(session.tenantId, async (tx) => {
    const [lead] = await tx
      .insert(participants)
      .values({
        tenantId: session.tenantId,
        firstName: parsed.data.firstName,
        lastName: parsed.data.lastName,
        email: parsed.data.email || null,
        phone,
        phoneNormalized: normalizePhone({ raw: phone }).normalized,
        city: parsed.data.city || null,
        source: parsed.data.source || null,
        assignedConsultantId: session.id,
      })
      .returning({ id: participants.id });

    await logActivity(tx, {
      tenantId: session.tenantId,
      actorKind: "internal_user",
      actorUserId: session.id,
      subjectKind: "participant",
      subjectId: lead.id,
      event: "lead_created",
    });
    return lead.id;
  });

  revalidatePath("/pipeline");
  redirect(leadPath(leadId));
}

// ---------------------------------------------------------------------------
// Bulk assignment (pipeline workspace) — assign/unassign many leads at once.
// Tenant-scoped via withTenant (RLS) and audited per lead. Status changes are
// intentionally NOT bulk-editable here: they run through the gated
// changeParticipantStatus path one lead at a time on the lead detail page.
// ---------------------------------------------------------------------------

const UNASSIGNED = "unassigned";

const bulkAssignSchema = z.object({
  participantIds: z.array(z.string().uuid()).min(1).max(500),
  consultant: z.union([z.literal(UNASSIGNED), z.string().uuid()]),
  returnTo: z.string().optional(),
});

/** Only redirect to known internal assignment surfaces (never an open redirect). */
function safeAssignmentReturn(returnTo: string | undefined): string {
  if (!returnTo) return "/pipeline";
  if (
    returnTo.startsWith("/pipeline") ||
    /^\/leads\/[0-9a-f-]{36}$/i.test(returnTo)
  ) {
    return returnTo;
  }
  return "/pipeline";
}

const appendAssignmentResult = (path: string, result: string): string => {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}assignment=${result}`;
};

export async function assignLeads(formData: FormData): Promise<void> {
  const session = await requireSession();
  const parsed = bulkAssignSchema.safeParse({
    participantIds: formData.getAll("participantId").map(String),
    consultant: formData.get("consultant"),
    returnTo: formData.get("returnTo")?.toString(),
  });
  if (!parsed.success) redirect(safeAssignmentReturn(undefined));

  const target =
    parsed.data.consultant === UNASSIGNED ? null : parsed.data.consultant;

  const result = await withTenant(session.tenantId, async (tx) => {
    const canReassign = canManageTenantRecords(session.role);
    if (!canReassign && target !== session.id) return "forbidden";
    // Reject a consultant that is not a real, active user in THIS tenant.
    // RLS scopes the lookup, so a cross-tenant id simply resolves to nothing.
    if (target) {
      const [consultant] = await tx
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.id, target),
            eq(users.tenantId, session.tenantId),
            eq(users.active, true),
          ),
        );
      if (!consultant) return "forbidden";
    }
    const existing = await tx
      .select({
        id: participants.id,
        assignedConsultantId: participants.assignedConsultantId,
      })
      .from(participants)
      .where(
        and(
          eq(participants.tenantId, session.tenantId),
          inArray(participants.id, parsed.data.participantIds),
        ),
      );
    const updated = await tx
      .update(participants)
      .set({ assignedConsultantId: target })
      .where(
        and(
          inArray(participants.id, parsed.data.participantIds),
          canReassign ? undefined : isNull(participants.assignedConsultantId),
        ),
      )
      .returning({ id: participants.id });
    for (const lead of updated) {
      const previous =
        existing.find((row) => row.id === lead.id)?.assignedConsultantId ?? null;
      await logActivity(tx, {
        tenantId: session.tenantId,
        actorKind: "internal_user",
        actorUserId: session.id,
        subjectKind: "participant",
        subjectId: lead.id,
        event: previous === null ? "lead_claimed" : "lead_reassigned",
        meta: {
          from: previous ?? "unassigned",
          to: target ?? "unassigned",
        },
      });
    }
    return updated.length > 0 ? "saved" : "forbidden";
  });

  revalidatePath("/pipeline");
  redirect(
    appendAssignmentResult(
      safeAssignmentReturn(parsed.data.returnTo),
      result,
    ),
  );
}

// ---------------------------------------------------------------------------
// Call outcomes + status changes (the call-script quick actions)
// ---------------------------------------------------------------------------

const statusSchema = z.enum(participants.status.enumValues);

export async function setLeadStatus(formData: FormData): Promise<void> {
  const session = await requireSession();
  const participantId = z.string().uuid().parse(formData.get("participantId"));
  const to = statusSchema.parse(formData.get("status"));
  const note = z.string().trim().max(4000).optional().parse(
    formData.get("note") ?? undefined,
  );

  let gateBlocked = false;
  let transitionBlocked = false;
  await withTenant(session.tenantId, async (tx) => {
    await requireLeadWrite(tx, session, participantId);
    try {
      await changeParticipantStatus(tx, {
        participantId,
        to,
        actorUserId: session.id,
      });
    } catch (error: unknown) {
      if (error instanceof AvailabilityGateError) {
        gateBlocked = true;
        return;
      }
      if (error instanceof ParticipantTransitionError) {
        transitionBlocked = true;
        return;
      }
      throw error;
    }
    if (note) {
      await addNoteRow(tx, session, participantId, note);
    }
  });

  revalidatePath(leadPath(participantId));
  revalidatePath("/pipeline");
  if (gateBlocked) redirect(`${leadPath(participantId)}?gate=1`);
  if (transitionBlocked) redirect(`${leadPath(participantId)}?transition=1`);
}

const availabilitySchema = z.enum(participants.availabilityStatus.enumValues);

export async function setAvailability(formData: FormData): Promise<void> {
  const session = await requireSession();
  const participantId = z.string().uuid().parse(formData.get("participantId"));
  const availability = availabilitySchema.parse(formData.get("availability"));

  await withTenant(session.tenantId, async (tx) => {
    await requireLeadWrite(tx, session, participantId);
    await recordAvailability(tx, {
      participantId,
      availability,
      actorKind: "internal_user",
      actorUserId: session.id,
    });
  });

  revalidatePath(leadPath(participantId));
  revalidatePath("/tasks");
}

// ---------------------------------------------------------------------------
// Undo — revert the last participant action (Ctrl/Cmd + Z)
// ---------------------------------------------------------------------------

type ParticipantStatus = (typeof participants.status.enumValues)[number];
type AvailabilityStatus =
  (typeof participants.availabilityStatus.enumValues)[number];
const REAL_STATUSES = new Set<string>(participants.status.enumValues);
const AVAILABILITY_VALUES = new Set<string>(
  participants.availabilityStatus.enumValues,
);
// recordAvailability logs "status_changed" with meta.status = `availability_<x>`.
const AVAILABILITY_PREFIX = "availability_";

// Task states that are still "live" and safe to cancel on undo. A `done` task
// is intentionally left alone — undoing must not silently reopen finished work.
const CANCELLABLE_TASK_STATES = [
  "open",
  "in_progress",
  "waiting",
  "escalated",
] as const;

// Column defaults — the fall-back target when a lead's *first* change is undone
// and there is no earlier event to revert to.
const DEFAULT_STATUS: ParticipantStatus = "new";
const DEFAULT_AVAILABILITY: AvailabilityStatus = "unclear";

/**
 * Cancels the still-pending tasks + scheduled reminders a transition spawned.
 * Tasks created in the same transaction share the change's transaction
 * timestamp, so `createdAt >= since` captures exactly that fan-out.
 */
async function cancelSpawnedTasks(
  tx: Tx,
  participantId: string,
  since: Date,
): Promise<number> {
  const cancelledTasks = await tx
    .update(tasks)
    .set({ status: "cancelled" })
    .where(
      and(
        eq(tasks.subjectKind, "participant"),
        eq(tasks.subjectId, participantId),
        gte(tasks.createdAt, since),
        inArray(tasks.status, [...CANCELLABLE_TASK_STATES]),
      ),
    )
    .returning({ id: tasks.id });

  if (cancelledTasks.length > 0) {
    await tx
      .update(reminderJobs)
      .set({ status: "cancelled" })
      .where(
        and(
          inArray(
            reminderJobs.taskId,
            cancelledTasks.map((t) => t.id),
          ),
          eq(reminderJobs.status, "scheduled"),
        ),
      );
  }
  return cancelledTasks.length;
}

/**
 * The console's Ctrl/Cmd+Z. Reverts the most recent reversible action on a
 * lead — a **status** change or an **availability** answer, whichever happened
 * last (both are recorded as `status_changed` events, told apart by their
 * meta.status). It reverts the affected column to the previous value (or the
 * initial default if this was the first change), cancels the still-pending
 * tasks/reminders that action spawned, and stamps a `*_reverted` audit event.
 *
 * It never re-runs the routing engine, so undo never spawns a fresh round of
 * tasks for the reverted-to value.
 */
export async function undoLastAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const participantId = z.string().uuid().parse(formData.get("participantId"));

  let outcome: "status" | "availability" | "none" = "none";
  await withTenant(session.tenantId, async (tx) => {
    await requireLeadWrite(tx, session, participantId);
    const [participant] = await tx
      .select()
      .from(participants)
      .where(eq(participants.id, participantId));
    if (!participant) return;

    const log = await tx
      .select({ meta: activityLog.meta, createdAt: activityLog.createdAt })
      .from(activityLog)
      .where(
        and(
          eq(activityLog.subjectId, participantId),
          eq(activityLog.event, "status_changed"),
        ),
      )
      .orderBy(desc(activityLog.createdAt));

    const events = log
      .map((row) => ({
        status: (row.meta as { status?: string } | null)?.status,
        createdAt: row.createdAt,
      }))
      .filter(
        (row): row is { status: string; createdAt: Date } =>
          typeof row.status === "string",
      );
    if (events.length === 0) return;

    const latest = events[0];

    if (latest.status.startsWith(AVAILABILITY_PREFIX)) {
      // Undo an availability answer → previous answer, else the default.
      const prior = events
        .slice(1)
        .find((e) => e.status.startsWith(AVAILABILITY_PREFIX));
      const answer = prior
        ? prior.status.slice(AVAILABILITY_PREFIX.length)
        : DEFAULT_AVAILABILITY;
      const target = (
        AVAILABILITY_VALUES.has(answer) ? answer : DEFAULT_AVAILABILITY
      ) as AvailabilityStatus;

      await tx
        .update(participants)
        .set({ availabilityStatus: target })
        .where(eq(participants.id, participantId));
      const cancelled = await cancelSpawnedTasks(
        tx,
        participantId,
        latest.createdAt,
      );
      await logActivity(tx, {
        tenantId: session.tenantId,
        actorKind: "internal_user",
        actorUserId: session.id,
        subjectKind: "participant",
        subjectId: participantId,
        event: "availability_reverted",
        meta: { to: target, cancelledTasks: cancelled },
      });
      outcome = "availability";
      return;
    }

    if (REAL_STATUSES.has(latest.status)) {
      // Undo a status change → previous real status, else the default.
      const prior = events.slice(1).find((e) => REAL_STATUSES.has(e.status));
      const target = (
        prior ? prior.status : DEFAULT_STATUS
      ) as ParticipantStatus;

      await tx
        .update(participants)
        .set({ status: target })
        .where(eq(participants.id, participantId));
      const cancelled = await cancelSpawnedTasks(
        tx,
        participantId,
        latest.createdAt,
      );
      await logActivity(tx, {
        tenantId: session.tenantId,
        actorKind: "internal_user",
        actorUserId: session.id,
        subjectKind: "participant",
        subjectId: participantId,
        event: "status_reverted",
        meta: { from: latest.status, to: target, cancelledTasks: cancelled },
      });
      outcome = "status";
    }
  });

  revalidatePath(leadPath(participantId));
  revalidatePath("/pipeline");
  revalidatePath("/tasks");
  redirect(`${leadPath(participantId)}?undo=${outcome}`);
}

// ---------------------------------------------------------------------------
// Eligibility (call-script data)
// ---------------------------------------------------------------------------

const eligibilitySchema = z.object({
  participantId: z.string().uuid(),
  employmentStatus: z
    .enum(participants.employmentStatus.enumValues)
    .optional(),
  employerId: z.string().uuid().optional().or(z.literal("")),
  measureId: z.string().uuid().optional().or(z.literal("")),
  eligibilityNotes: z.string().trim().max(4000).optional(),
});

export async function updateEligibility(formData: FormData): Promise<void> {
  const session = await requireSession();
  const parsed = eligibilitySchema.parse({
    participantId: formData.get("participantId"),
    employmentStatus: formData.get("employmentStatus") || undefined,
    employerId: formData.get("employerId") ?? "",
    measureId: formData.get("measureId") ?? "",
    eligibilityNotes: formData.get("eligibilityNotes") ?? undefined,
  });

  await withTenant(session.tenantId, async (tx) => {
    await requireLeadWrite(tx, session, parsed.participantId);
    await tx
      .update(participants)
      .set({
        employmentStatus: parsed.employmentStatus ?? null,
        employerId: parsed.employerId || null,
        measureId: parsed.measureId || null,
        eligibilityNotes: parsed.eligibilityNotes || null,
      })
      .where(eq(participants.id, parsed.participantId));

    await logActivity(tx, {
      tenantId: session.tenantId,
      actorKind: "internal_user",
      actorUserId: session.id,
      subjectKind: "participant",
      subjectId: parsed.participantId,
      event: "eligibility_updated",
    });
  });

  revalidatePath(leadPath(parsed.participantId));
}

// ---------------------------------------------------------------------------
// BA application data (Epic A) — consultant records the §186 data gaps so the
// BA forms can be prefilled. Scalars are validated conservatively (only a
// malformed non-empty value is rejected); structured sets are parsed to jsonb.
// ---------------------------------------------------------------------------

const baScalarSchema = z.object({
  participantId: z.string().uuid(),
  svNumber: z.string().trim().max(20).optional(),
  iban: z.string().trim().max(40).optional(),
  bic: z.string().trim().max(20).optional(),
});

export async function updateParticipantBaData(
  formData: FormData,
): Promise<void> {
  const session = await requireSession();
  const read = (key: string): string | undefined =>
    formData.get(key)?.toString();
  const parsed = baScalarSchema.safeParse({
    participantId: formData.get("participantId"),
    svNumber: read("svNumber"),
    iban: read("iban"),
    bic: read("bic"),
  });
  if (!parsed.success) redirect("/pipeline");
  const { participantId, svNumber, iban, bic } = parsed.data;

  // Reject only malformed non-empty values — a valid input always passes.
  if (svNumber && !isValidSvNumber(svNumber))
    redirect(`${leadPath(participantId)}?badata=sv`);
  if (iban && !isValidIban(iban))
    redirect(`${leadPath(participantId)}?badata=iban`);
  if (bic && !isValidBic(bic))
    redirect(`${leadPath(participantId)}?badata=bic`);

  await withTenant(session.tenantId, async (tx) => {
    await requireLeadWrite(tx, session, participantId);
    await tx
      .update(participants)
      .set({
        svNumber: svNumber ? normalizeSvNumber(svNumber) : null,
        iban: iban ? normalizeIban(iban) : null,
        bic: bic ? normalizeBic(bic) : null,
        monthlyGrossSalary: parseDecimalString(read("monthlyGrossSalary")),
        weeklyWorkingHours: parseDecimalString(read("weeklyWorkingHours")),
        monthlyWorkingHours: parseDecimalString(read("monthlyWorkingHours")),
        freistellungsstunden: parseDecimalString(read("freistellungsstunden")),
        salaryComponents: parseSalaryComponents(read),
        schulungszeiten: parseWeeklyTimes(read),
        qualificationHistory: parseQualificationHistory(read),
        fundingStatus: parseFundingStatus(read),
      })
      .where(eq(participants.id, participantId));

    await logActivity(tx, {
      tenantId: session.tenantId,
      actorKind: "internal_user",
      actorUserId: session.id,
      subjectKind: "participant",
      subjectId: participantId,
      event: "ba_data_updated",
    });
  });

  revalidatePath(leadPath(participantId));
  redirect(`${leadPath(participantId)}?badata=saved`);
}

// ---------------------------------------------------------------------------
// Contact notes
// ---------------------------------------------------------------------------

async function addNoteRow(
  tx: Tx,
  session: SessionUser,
  participantId: string,
  body: string,
  noteChannel: "internal" | "email" | "whatsapp" = "internal",
): Promise<void> {
  await tx.insert(contactNotes).values({
    tenantId: session.tenantId,
    participantId,
    authorUserId: session.id,
    channel: noteChannel,
    body,
  });
}

export async function addContactNote(formData: FormData): Promise<void> {
  const session = await requireSession();
  const participantId = z.string().uuid().parse(formData.get("participantId"));
  const body = z.string().trim().min(1).max(4000).parse(formData.get("body"));

  await withTenant(session.tenantId, async (tx) => {
    await requireLeadWrite(tx, session, participantId);
    await addNoteRow(tx, session, participantId, body);
  });
  revalidatePath(leadPath(participantId));
}

// ---------------------------------------------------------------------------
// Participant magic-link tasks minted on demand from the lead page: consent
// (DSGVO — the readiness gate requires it before an application can be
// completed) and document upload. Without these actions nothing in the
// product could create tasks of these types.
// ---------------------------------------------------------------------------

type ParticipantTaskKind = "give_consent" | "upload_documents";

/**
 * Returns the magic-link URL for the participant's OPEN task of the given
 * kind, creating the task first when none exists. Repeated clicks re-mint the
 * link on the same task (superseding the old token), never stacking
 * duplicates — the unique active-task index guards the concurrent-create race.
 */
async function mintParticipantTaskLink(
  session: SessionUser,
  participantId: string,
  kind: ParticipantTaskKind,
  title: string,
): Promise<string | null> {
  return withTenant(session.tenantId, async (tx) => {
    await requireLeadWrite(tx, session, participantId);
    const [participant] = await tx
      .select({ id: participants.id })
      .from(participants)
      .where(eq(participants.id, participantId));
    if (!participant) return null;

    const openTask = () =>
      tx
        .select()
        .from(tasks)
        .where(
          and(
            eq(tasks.tenantId, session.tenantId),
            eq(tasks.type, kind),
            eq(tasks.ownerParticipantId, participantId),
            inArray(tasks.status, [...ACTIVE_TASK_STATUSES]),
          ),
        )
        .limit(1);

    const [existing] = await openTask();
    if (existing) return getOrIssueMagicLinkForTask(tx, existing);

    const [task] = await tx
      .insert(tasks)
      .values({
        tenantId: session.tenantId,
        type: kind,
        title,
        status: "open",
        ownerKind: "participant",
        ownerParticipantId: participantId,
        channel: "magic_link",
        subjectKind: "participant",
        subjectId: participantId,
        dueAt: new Date(Date.now() + 72 * 3_600_000),
        escalationAt: new Date(Date.now() + 120 * 3_600_000),
      })
      .onConflictDoNothing()
      .returning();

    // Lost a concurrent-create race → reuse the winner's task.
    const taskRow = task ?? (await openTask())[0];
    if (!taskRow) return null;

    await logActivity(tx, {
      tenantId: session.tenantId,
      actorKind: "internal_user",
      actorUserId: session.id,
      subjectKind: "task",
      subjectId: taskRow.id,
      event: "task_created",
      meta: { taskType: kind },
    });
    return getOrIssueMagicLinkForTask(tx, taskRow);
  });
}

export async function requestConsentLink(formData: FormData): Promise<void> {
  const session = await requireSession();
  const participantId = z.string().uuid().parse(formData.get("participantId"));

  const url = await mintParticipantTaskLink(
    session,
    participantId,
    "give_consent",
    "Datenschutz- & Kontakt-Einwilligung erteilen",
  );

  redirect(
    url
      ? `${leadPath(participantId)}?consentLink=${encodeURIComponent(url)}`
      : leadPath(participantId),
  );
}

export async function requestUploadLink(formData: FormData): Promise<void> {
  const session = await requireSession();
  const participantId = z.string().uuid().parse(formData.get("participantId"));

  const url = await mintParticipantTaskLink(
    session,
    participantId,
    "upload_documents",
    "Unterlagen hochladen (Nachweise für den Antrag)",
  );

  redirect(
    url
      ? `${leadPath(participantId)}?uploadLink=${encodeURIComponent(url)}`
      : leadPath(participantId),
  );
}

// ---------------------------------------------------------------------------
// Appointments (Phase 3)
// ---------------------------------------------------------------------------

const appointmentSchema = z.object({
  participantId: z.string().uuid(),
  type: z.enum(appointments.type.enumValues),
  scheduledAt: z.string().min(1),
  notes: z.string().trim().max(2000).optional(),
});

export async function scheduleAppointment(formData: FormData): Promise<void> {
  const session = await requireSession();
  const parsed = appointmentSchema.parse({
    participantId: formData.get("participantId"),
    type: formData.get("type"),
    scheduledAt: formData.get("scheduledAt"),
    notes: formData.get("notes") ?? undefined,
  });
  const scheduledAt = new Date(parsed.scheduledAt);
  if (Number.isNaN(scheduledAt.getTime())) return;

  let gateBlocked = false;
  await withTenant(session.tenantId, async (tx) => {
    await requireLeadWrite(tx, session, parsed.participantId);
    const [participant] = await tx
      .select()
      .from(participants)
      .where(eq(participants.id, parsed.participantId));
    if (!participant) return;

    // Same 20h/6-month gate as status transitions — the aptitude-test
    // appointment must not be booked before availability is a clear "yes".
    try {
      assertAppointmentAvailability(parsed.type, participant.availabilityStatus);
    } catch (error: unknown) {
      if (error instanceof AvailabilityGateError) {
        gateBlocked = true;
        return;
      }
      throw error;
    }

    const [appointment] = await tx
      .insert(appointments)
      .values({
        tenantId: session.tenantId,
        participantId: participant.id,
        consultantId: session.id,
        type: parsed.type,
        scheduledAt,
        notes: parsed.notes || null,
      })
      .returning({ id: appointments.id });

    // "scheduled" transition → reminder task + WhatsApp/call reminder jobs.
    await processTransition(tx, {
      tenantId: session.tenantId,
      entity: "appointment",
      entityId: appointment.id,
      status: "scheduled",
      actorKind: "internal_user",
      actorUserId: session.id,
      context: {
        participantId: participant.id,
        employerId: participant.employerId ?? undefined,
        consultantId: session.id,
        referenceAt: scheduledAt,
        variables: {
          time: scheduledAt.toLocaleString("de-DE", {
            timeZone: "Europe/Berlin",
            dateStyle: "medium",
            timeStyle: "short",
          }),
        },
      },
    });
  });

  revalidatePath(leadPath(parsed.participantId));
  revalidatePath("/appointments");
  if (gateBlocked) redirect(`${leadPath(parsed.participantId)}?gate=1`);
}

const appointmentStatusSchema = z.enum(appointments.status.enumValues);

export async function setAppointmentStatus(formData: FormData): Promise<void> {
  const session = await requireSession();
  const appointmentId = z.string().uuid().parse(formData.get("appointmentId"));
  const status = appointmentStatusSchema.parse(formData.get("status"));

  await withTenant(session.tenantId, async (tx) => {
    const [appointment] = await tx
      .select()
      .from(appointments)
      .where(eq(appointments.id, appointmentId));
    if (!appointment) return;
    await requireLeadWrite(tx, session, appointment.participantId);

    await tx
      .update(appointments)
      .set({ status })
      .where(eq(appointments.id, appointmentId));

    const [participant] = await tx
      .select()
      .from(participants)
      .where(eq(participants.id, appointment.participantId));

    await processTransition(tx, {
      tenantId: session.tenantId,
      entity: "appointment",
      entityId: appointmentId,
      status,
      actorKind: "internal_user",
      actorUserId: session.id,
      context: {
        participantId: appointment.participantId,
        employerId: participant?.employerId ?? undefined,
        consultantId: appointment.consultantId ?? session.id,
      },
    });
  });

  revalidatePath("/appointments");
}

// ---------------------------------------------------------------------------
// Aptitude tests (Phase 3: status tracking)
// ---------------------------------------------------------------------------

export async function inviteAptitudeTest(formData: FormData): Promise<void> {
  const session = await requireSession();
  const participantId = z.string().uuid().parse(formData.get("participantId"));

  let gateBlocked = false;
  await withTenant(session.tenantId, async (tx) => {
    await requireLeadWrite(tx, session, participantId);
    const [participant] = await tx
      .select()
      .from(participants)
      .where(eq(participants.id, participantId));
    if (!participant) return;

    // Gate the invite behind the same availability confirmation used for the
    // qualified/test_phase status transitions — no reimplementation of the rule.
    try {
      assertAptitudeInviteAvailability(participant.availabilityStatus);
    } catch (error: unknown) {
      if (error instanceof AvailabilityGateError) {
        gateBlocked = true;
        return;
      }
      throw error;
    }

    const [test] = await tx
      .insert(aptitudeTests)
      .values({
        tenantId: session.tenantId,
        participantId,
        status: "invited",
        invitedAt: new Date(),
        testUrl: resolveAptitudeTestUrl(participantId),
      })
      .returning({ id: aptitudeTests.id });

    // Rule sends the participant a magic link + schedules 24h/48h reminders.
    await processTransition(tx, {
      tenantId: session.tenantId,
      entity: "aptitude_test",
      entityId: test.id,
      status: "invited",
      actorKind: "internal_user",
      actorUserId: session.id,
      context: {
        participantId,
        employerId: participant.employerId ?? undefined,
        consultantId: participant.assignedConsultantId ?? session.id,
      },
    });
  });

  revalidatePath(leadPath(participantId));
  if (gateBlocked) redirect(`${leadPath(participantId)}?gate=1`);
}

const testStatusSchema = z.enum(aptitudeTests.status.enumValues);

export async function setAptitudeTestStatus(
  formData: FormData,
): Promise<void> {
  const session = await requireSession();
  const testId = z.string().uuid().parse(formData.get("testId"));
  const status = testStatusSchema.parse(formData.get("status"));

  await withTenant(session.tenantId, async (tx) => {
    const [test] = await tx
      .select()
      .from(aptitudeTests)
      .where(eq(aptitudeTests.id, testId));
    if (!test) return;
    await requireLeadWrite(tx, session, test.participantId);

    await tx
      .update(aptitudeTests)
      .set({
        status,
        startedAt: status === "started" ? new Date() : test.startedAt,
        completedAt: ["completed", "passed", "failed"].includes(status)
          ? new Date()
          : test.completedAt,
      })
      .where(eq(aptitudeTests.id, testId));

    const [participant] = await tx
      .select()
      .from(participants)
      .where(eq(participants.id, test.participantId));

    await processTransition(tx, {
      tenantId: session.tenantId,
      entity: "aptitude_test",
      entityId: testId,
      status,
      actorKind: "internal_user",
      actorUserId: session.id,
      context: {
        participantId: test.participantId,
        employerId: participant?.employerId ?? undefined,
        consultantId: participant?.assignedConsultantId ?? session.id,
      },
    });
  });

  revalidatePath("/tasks");
  revalidatePath("/pipeline");
}

// ---------------------------------------------------------------------------
// Task completion (internal dashboard)
// ---------------------------------------------------------------------------

export async function completeTask(formData: FormData): Promise<void> {
  const session = await requireSession();
  const taskId = z.string().uuid().parse(formData.get("taskId"));

  await withTenant(session.tenantId, async (tx) => {
    const access = await resolveTaskWriteAccess(tx, taskId, {
      userId: session.id,
      role: session.role,
    });
    if (access !== "allowed") redirect(`/tasks?access=${access}`);
    await tx
      .update(tasks)
      .set({ status: "done", completedAt: new Date() })
      .where(eq(tasks.id, taskId));

    await logActivity(tx, {
      tenantId: session.tenantId,
      actorKind: "internal_user",
      actorUserId: session.id,
      subjectKind: "task",
      subjectId: taskId,
      event: "task_completed",
    });
  });

  revalidatePath("/tasks");
}
