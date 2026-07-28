import { eq, or, sql, type SQL } from "drizzle-orm";
import type { DbHandle } from "@/db/client";
import { participants, tasks } from "@/db/schema";
import {
  canManageTenantRecords,
  getTaskWriteDecision,
  type ParticipantAccessContext,
  type WriteAccessDecision,
} from "./authorization";

/**
 * Consultant task policy: own internal tasks plus participant-owned tasks for
 * assigned or unassigned-pool participants. Employer-only tasks have no safe
 * participant ownership mapping and therefore remain manager/admin-only.
 */
export const buildTaskAccessCondition = (
  context: ParticipantAccessContext,
): SQL | undefined => {
  if (canManageTenantRecords(context.role)) return undefined;
  return or(
    eq(tasks.ownerUserId, context.userId),
    sql`exists (
      select 1 from participants access_participant
      where access_participant.id = coalesce(
        ${tasks.ownerParticipantId},
        case when ${tasks.subjectKind} = 'participant' then ${tasks.subjectId} end
      )
      and (
        access_participant.assigned_consultant_id = ${context.userId}
        or access_participant.assigned_consultant_id is null
      )
    )`,
  ) as SQL;
};

export const canAccessTask = async (
  tx: DbHandle,
  taskId: string,
  context: ParticipantAccessContext,
): Promise<boolean> => {
  const [row] = await tx
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      sql`${tasks.id} = ${taskId} and ${buildTaskAccessCondition(context) ?? sql`true`}`,
    )
    .limit(1);
  return Boolean(row);
};

/** Write scope is stricter than read scope: pool tasks require a prior claim. */
export const resolveTaskWriteAccess = async (
  tx: DbHandle,
  taskId: string,
  context: ParticipantAccessContext,
): Promise<WriteAccessDecision> => {
  const [row] = await tx
    .select({
      ownerUserId: tasks.ownerUserId,
      ownerParticipantId: tasks.ownerParticipantId,
      subjectKind: tasks.subjectKind,
      subjectId: tasks.subjectId,
      participantAssignedConsultantId: participants.assignedConsultantId,
    })
    .from(tasks)
    .leftJoin(
      participants,
      sql`${participants.id} = coalesce(
        ${tasks.ownerParticipantId},
        case when ${tasks.subjectKind} = 'participant' then ${tasks.subjectId} end
      )`,
    )
    .where(eq(tasks.id, taskId))
    .limit(1);
  if (!row) return "forbidden";
  return getTaskWriteDecision({
    context,
    ownerUserId: row.ownerUserId,
    participantAssignedConsultantId:
      row.participantAssignedConsultantId ?? null,
    hasParticipantOwner:
      row.ownerParticipantId !== null ||
      (row.subjectKind === "participant" && row.subjectId !== null),
  });
};
