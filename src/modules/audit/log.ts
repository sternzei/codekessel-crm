import type { DbHandle } from "@/db/client";
import { activityLog } from "@/db/schema";

type EntityKind = (typeof activityLog.subjectKind.enumValues)[number];
type ActorKind = (typeof activityLog.actorKind.enumValues)[number];

export type AuditEvent = {
  tenantId: string;
  actorKind: ActorKind;
  actorUserId?: string;
  subjectKind: EntityKind;
  subjectId: string;
  event: string;
  // PII-minimal: IDs, statuses, counts. Never names, phones, or free text.
  meta?: Record<string, string | number | boolean | null>;
};

export async function logActivity(tx: DbHandle, e: AuditEvent): Promise<void> {
  await tx.insert(activityLog).values({
    tenantId: e.tenantId,
    actorKind: e.actorKind,
    actorUserId: e.actorUserId,
    subjectKind: e.subjectKind,
    subjectId: e.subjectId,
    event: e.event,
    meta: e.meta,
  });
}
