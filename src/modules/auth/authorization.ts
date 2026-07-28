import type { PipelineFilter } from "@/modules/participants/pipeline-filter";

export type AppRole = "consultant" | "manager" | "admin";

export interface ParticipantAccessContext {
  readonly userId: string;
  readonly role: AppRole;
}

export type CloudApprovalDecision =
  | "allowed"
  | "forbidden_role"
  | "self_approval";

export type WriteAccessDecision = "allowed" | "must_claim" | "forbidden";

/**
 * Tenant-wide CRM record management. This intentionally does not authorize
 * admin-only product surfaces such as OpenRegister import.
 */
export const canManageTenantRecords = (role: AppRole): boolean =>
  role === "manager" || role === "admin";

export const getRoleLabel = (role: AppRole): string => {
  if (role === "manager") return "Teamleitung";
  if (role === "admin") return "Administration";
  return "Beratung";
};

export const canAccessParticipant = (
  context: ParticipantAccessContext,
  assignedConsultantId: string | null,
): boolean => {
  if (canManageTenantRecords(context.role)) return true;
  return assignedConsultantId === null || assignedConsultantId === context.userId;
};

export const getParticipantWriteDecision = (
  context: ParticipantAccessContext,
  assignedConsultantId: string | null,
): WriteAccessDecision => {
  if (canManageTenantRecords(context.role)) return "allowed";
  if (assignedConsultantId === null) return "must_claim";
  return assignedConsultantId === context.userId ? "allowed" : "forbidden";
};

export const getTaskWriteDecision = ({
  context,
  ownerUserId,
  participantAssignedConsultantId,
  hasParticipantOwner,
}: {
  readonly context: ParticipantAccessContext;
  readonly ownerUserId: string | null;
  readonly participantAssignedConsultantId: string | null;
  readonly hasParticipantOwner: boolean;
}): WriteAccessDecision => {
  if (canManageTenantRecords(context.role)) return "allowed";
  if (ownerUserId === context.userId && !hasParticipantOwner) return "allowed";
  if (!hasParticipantOwner) return "forbidden";
  return getParticipantWriteDecision(
    context,
    participantAssignedConsultantId,
  );
};

export const canAssignParticipant = (
  context: ParticipantAccessContext,
  currentConsultantId: string | null,
  targetConsultantId: string | null,
): boolean => {
  if (canManageTenantRecords(context.role)) return true;
  return currentConsultantId === null && targetConsultantId === context.userId;
};

export const canApproveCloudMessage = ({
  approver,
  createdByUserId,
}: {
  readonly approver: ParticipantAccessContext;
  readonly createdByUserId: string | null;
}): CloudApprovalDecision => {
  if (!canManageTenantRecords(approver.role)) return "forbidden_role";
  if (createdByUserId === approver.userId) return "self_approval";
  return "allowed";
};

export const normalizeParticipantFilter = (
  filter: PipelineFilter,
  context: ParticipantAccessContext,
): PipelineFilter => {
  const scopedFilter: PipelineFilter = {
    ...filter,
    statuses: [...filter.statuses],
  };
  if (canManageTenantRecords(context.role)) return scopedFilter;
  if (filter.unassigned || filter.consultantId === context.userId) {
    return scopedFilter;
  }
  delete scopedFilter.consultantId;
  return scopedFilter;
};
