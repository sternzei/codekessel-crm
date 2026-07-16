import { desc, eq, or } from "drizzle-orm";
import type { DbHandle } from "@/db/client";
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

export type LeadDetail = NonNullable<
  Awaited<ReturnType<typeof getLeadDetail>>
>;

export async function getLeadDetail(tx: DbHandle, id: string) {
  const [participant] = await tx
    .select()
    .from(participants)
    .where(eq(participants.id, id));
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

  const activity = await tx
    .select()
    .from(activityLog)
    .where(eq(activityLog.subjectId, id))
    .orderBy(desc(activityLog.createdAt))
    .limit(15);

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
