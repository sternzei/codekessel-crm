import { eq } from "drizzle-orm";
import type { DbHandle } from "@/db/client";
import { employers, participants } from "@/db/schema";
import { logActivity } from "@/modules/audit/log";
import { getAdapter } from "./adapters";
import { renderTemplate } from "./templates";
import type { Recipient } from "./types";
import type { TemplateVariables } from "./templates";

export type TaskMessageParams = {
  tenantId: string;
  taskId: string;
  channel: "whatsapp" | "email";
  templateKey: string;
  recipient: Recipient;
  variables: TemplateVariables;
};

/**
 * Renders + dispatches one message for a task and records a PII-free entry
 * in the activity log. Used by the routing engine (on task creation) and by
 * the reminder worker (on due reminder jobs).
 */
export async function sendTaskMessage(
  tx: DbHandle,
  params: TaskMessageParams,
): Promise<boolean> {
  const rendered = await renderTemplate(
    tx,
    params.templateKey,
    params.channel,
    params.variables,
  );

  const result = await getAdapter(params.channel).send({
    tenantId: params.tenantId,
    channel: params.channel,
    recipient: params.recipient,
    subject: rendered.subject,
    body: rendered.body,
    templateKey: params.templateKey,
    taskId: params.taskId,
  });

  await logActivity(tx, {
    tenantId: params.tenantId,
    actorKind: "system",
    subjectKind: "task",
    subjectId: params.taskId,
    event: result.ok ? "message_sent" : "message_failed",
    meta: {
      channel: params.channel,
      templateKey: params.templateKey,
      recipientKind: params.recipient.kind,
    },
  });

  return result.ok;
}

/** Resolve name + addresses for a task owner. */
export async function resolveRecipient(
  tx: DbHandle,
  ownerKind: "participant" | "employer",
  ownerId: string,
): Promise<Recipient | null> {
  if (ownerKind === "participant") {
    const [p] = await tx
      .select({
        firstName: participants.firstName,
        lastName: participants.lastName,
        email: participants.email,
        phone: participants.phone,
      })
      .from(participants)
      .where(eq(participants.id, ownerId));
    if (!p) return null;
    return {
      kind: "participant",
      id: ownerId,
      email: p.email,
      phone: p.phone,
      displayName: p.firstName,
    };
  }

  const [e] = await tx
    .select({
      companyName: employers.companyName,
      contactName: employers.contactName,
      email: employers.contactEmail,
      phone: employers.contactPhone,
    })
    .from(employers)
    .where(eq(employers.id, ownerId));
  if (!e) return null;
  return {
    kind: "employer",
    id: ownerId,
    email: e.email,
    phone: e.phone,
    displayName: e.contactName ?? e.companyName,
  };
}
