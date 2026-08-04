import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { DbHandle } from "@/db/client";
import { employers, participants, tasks, users } from "@/db/schema";
import type { ParticipantAccessContext } from "@/modules/auth/authorization";
import { buildTaskAccessCondition } from "@/modules/auth/task-scope";

export type OpenTask = {
  id: string;
  title: string;
  // Detail supplied by whoever triggered the transition — rule titles are
  // fixed templates, so this is where a task says which field is missing.
  description: string | null;
  type: string;
  status: string;
  ownerKind: "internal_user" | "participant" | "employer";
  ownerName: string | null;
  channel: string;
  dueAt: Date | null;
  // Whether the (external) owner has a phone — drives the "Send WhatsApp"
  // button. A boolean, never the number itself, so no PII enters the list.
  ownerHasPhone: boolean;
  // Magic-link credential state, so a consultant sees whether the task has a
  // usable link and whether a prior link was revoked/superseded.
  hasLiveLink: boolean;
  revokedLinkCount: number;
};

export async function listOpenTasks(
  tx: DbHandle,
  context: ParticipantAccessContext,
): Promise<OpenTask[]> {
  return tx
    .select({
      id: tasks.id,
      title: tasks.title,
      description: tasks.description,
      type: tasks.type,
      status: tasks.status,
      ownerKind: tasks.ownerKind,
      ownerName: sql<string | null>`coalesce(
        ${users.name},
        ${participants.firstName} || ' ' || ${participants.lastName},
        ${employers.companyName}
      )`,
      channel: tasks.channel,
      dueAt: tasks.dueAt,
      ownerHasPhone: sql<boolean>`(
        coalesce(${participants.phone}, ${employers.contactPhone}) is not null
      )`,
      // Correlated subqueries over magic_link_tokens; RLS still applies since
      // the whole read runs inside the tenant-scoped withTenant transaction.
      hasLiveLink: sql<boolean>`exists (
        select 1 from magic_link_tokens mlt
        where mlt.task_id = ${tasks.id}
          and mlt.used_at is null
          and mlt.revoked_at is null
          and mlt.expires_at > now()
      )`,
      revokedLinkCount: sql<number>`(
        select count(*)::int from magic_link_tokens mlt
        where mlt.task_id = ${tasks.id} and mlt.revoked_at is not null
      )`,
    })
    .from(tasks)
    .leftJoin(users, eq(tasks.ownerUserId, users.id))
    .leftJoin(participants, eq(tasks.ownerParticipantId, participants.id))
    .leftJoin(employers, eq(tasks.ownerEmployerId, employers.id))
    .where(
      and(
        inArray(tasks.status, ["open", "in_progress", "waiting", "escalated"]),
        buildTaskAccessCondition(context),
      ),
    )
    .orderBy(asc(tasks.dueAt));
}
