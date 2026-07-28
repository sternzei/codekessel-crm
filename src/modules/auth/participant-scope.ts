import { eq, isNull, or, type SQL } from "drizzle-orm";
import type { DbHandle } from "@/db/client";
import { participants } from "@/db/schema";
import {
  canManageTenantRecords,
  getParticipantWriteDecision,
  type ParticipantAccessContext,
  type WriteAccessDecision,
} from "./authorization";

/** Database predicate for the approved participant visibility model. */
export const buildParticipantAccessCondition = (
  context: ParticipantAccessContext,
): SQL | undefined => {
  if (canManageTenantRecords(context.role)) return undefined;
  return or(
    eq(participants.assignedConsultantId, context.userId),
    isNull(participants.assignedConsultantId),
  ) as SQL;
};

export const resolveParticipantWriteAccess = async (
  tx: DbHandle,
  participantId: string,
  context: ParticipantAccessContext,
): Promise<WriteAccessDecision> => {
  const [row] = await tx
    .select({
      assignedConsultantId: participants.assignedConsultantId,
    })
    .from(participants)
    .where(eq(participants.id, participantId))
    .limit(1);
  if (!row) return "forbidden";
  return getParticipantWriteDecision(context, row.assignedConsultantId);
};
