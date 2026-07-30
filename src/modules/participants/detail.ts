import { and, desc, eq, or } from "drizzle-orm";
import type { DbHandle } from "@/db/client";
import type { ParticipantAccessContext } from "@/modules/auth/authorization";
import { buildParticipantAccessCondition } from "@/modules/auth/participant-scope";
import {
  activityLog,
  appointments,
  aptitudeTests,
  contactNotes,
  employers,
  measures,
  participants,
  tasks,
  users,
} from "@/db/schema";

export const LEAD_ACTIVITY_PAGE_SIZE = 15;
export const LEAD_ACTIVITY_MAX = 100;

export type LeadActivityEntry = {
  readonly id: string;
  readonly event: string;
  readonly meta: unknown;
  readonly createdAt: Date;
  readonly actorKind: string;
  readonly actorUserId: string | null;
  readonly actorName: string | null;
};

export type LeadDetail = NonNullable<
  Awaited<ReturnType<typeof getLeadDetail>>
>;

export async function listLeadActivity(
  tx: DbHandle,
  participantId: string,
  limit: number = LEAD_ACTIVITY_PAGE_SIZE,
): Promise<LeadActivityEntry[]> {
  const safeLimit = Math.min(
    Math.max(1, limit),
    LEAD_ACTIVITY_MAX,
  );
  return tx
    .select({
      id: activityLog.id,
      event: activityLog.event,
      meta: activityLog.meta,
      createdAt: activityLog.createdAt,
      actorKind: activityLog.actorKind,
      actorUserId: activityLog.actorUserId,
      actorName: users.name,
    })
    .from(activityLog)
    .leftJoin(users, eq(activityLog.actorUserId, users.id))
    .where(eq(activityLog.subjectId, participantId))
    .orderBy(desc(activityLog.createdAt))
    .limit(safeLimit);
}

export async function getLeadDetail(
  tx: DbHandle,
  id: string,
  context: ParticipantAccessContext,
  options: { readonly activityLimit?: number } = {},
) {
  const [participant] = await tx
    .select()
    .from(participants)
    .where(
      and(
        eq(participants.id, id),
        buildParticipantAccessCondition(context),
      ),
    );
  if (!participant) return null;

  const [employer] = participant.employerId
    ? await tx
        .select()
        .from(employers)
        .where(eq(employers.id, participant.employerId))
    : [];
  const [measure] = participant.measureId
    ? await tx
        .select()
        .from(measures)
        .where(eq(measures.id, participant.measureId))
    : [];

  const notes = await tx
    .select({
      id: contactNotes.id,
      body: contactNotes.body,
      channel: contactNotes.channel,
      createdAt: contactNotes.createdAt,
      authorName: users.name,
    })
    .from(contactNotes)
    .leftJoin(users, eq(contactNotes.authorUserId, users.id))
    .where(eq(contactNotes.participantId, id))
    .orderBy(desc(contactNotes.createdAt));

  const appointmentRows = await tx
    .select()
    .from(appointments)
    .where(eq(appointments.participantId, id))
    .orderBy(desc(appointments.scheduledAt));

  const testRows = await tx
    .select()
    .from(aptitudeTests)
    .where(eq(aptitudeTests.participantId, id))
    .orderBy(desc(aptitudeTests.createdAt));

  const taskRows = await tx
    .select()
    .from(tasks)
    .where(
      or(
        eq(tasks.ownerParticipantId, id),
        eq(tasks.subjectId, id),
      ),
    )
    .orderBy(desc(tasks.createdAt))
    .limit(20);

  const activity = await listLeadActivity(
    tx,
    id,
    options.activityLimit ?? LEAD_ACTIVITY_PAGE_SIZE,
  );

  return {
    participant,
    employer: employer ?? null,
    measure: measure ?? null,
    notes,
    appointments: appointmentRows,
    tests: testRows,
    tasks: taskRows,
    activity,
  };
}

export async function listEmployerOptions(tx: DbHandle) {
  return tx
    .select({ id: employers.id, companyName: employers.companyName })
    .from(employers)
    .orderBy(employers.companyName);
}

export async function listMeasureOptions(tx: DbHandle) {
  return tx
    .select({ id: measures.id, name: measures.name })
    .from(measures)
    .orderBy(measures.name);
}
