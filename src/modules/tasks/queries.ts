import { asc, eq, inArray, sql } from "drizzle-orm";
import type { DbHandle } from "@/db/client";
import { employers, participants, tasks, users } from "@/db/schema";

export type OpenTask = {
  id: string;
  title: string;
  type: string;
  status: string;
  ownerKind: "internal_user" | "participant" | "employer";
  ownerName: string | null;
  channel: string;
  dueAt: Date | null;
  // Whether the (external) owner has a phone — drives the "Send WhatsApp"
  // button. A boolean, never the number itself, so no PII enters the list.
  ownerHasPhone: boolean;
};

export async function listOpenTasks(tx: DbHandle): Promise<OpenTask[]> {
  return tx
    .select({
      id: tasks.id,
      title: tasks.title,
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
    })
    .from(tasks)
    .leftJoin(users, eq(tasks.ownerUserId, users.id))
    .leftJoin(participants, eq(tasks.ownerParticipantId, participants.id))
    .leftJoin(employers, eq(tasks.ownerEmployerId, employers.id))
    .where(inArray(tasks.status, ["open", "in_progress", "waiting", "escalated"]))
    .orderBy(asc(tasks.dueAt));
}
