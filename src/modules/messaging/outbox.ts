import { and, desc, eq } from "drizzle-orm";
import type { DbHandle } from "@/db/client";
import { outboundMessages } from "@/db/schema";
import { logActivity } from "@/modules/audit/log";
import { getAdapter } from "./adapters";
import { recordOutboundDelivery } from "./deliveries";
import { renderTemplate } from "./templates";
import { canApprove, canCancel, canReject, statusForSendResult } from "./outbound-status";
import type { ChannelAdapter, MessageChannel, Recipient } from "./types";
import type { TemplateVariables } from "./templates";

export type EnqueueTaskMessageParams = {
  tenantId: string;
  taskId: string;
  channel: MessageChannel;
  templateKey: string;
  recipient: Recipient;
  variables: TemplateVariables;
};

/**
 * Approval gate entry point. Renders the message and writes ONE pending row to
 * the outbox instead of dispatching — nothing reaches the provider here. All
 * system send paths (routing engine, reminder worker, manual internal action)
 * funnel through this so no outbound message is sent without a later human
 * approve action. Returns true once the pending row exists.
 */
export async function enqueueTaskMessage(
  tx: DbHandle,
  params: EnqueueTaskMessageParams,
): Promise<boolean> {
  const rendered = await renderTemplate(
    tx,
    params.templateKey,
    params.channel,
    params.variables,
  );
  const [row] = await tx
    .insert(outboundMessages)
    .values({
      tenantId: params.tenantId,
      taskId: params.taskId,
      channel: params.channel,
      templateKey: params.templateKey,
      recipientKind: params.recipient.kind,
      recipientId: params.recipient.id,
      recipientPhone: params.recipient.phone ?? null,
      recipientEmail: params.recipient.email ?? null,
      recipientName: params.recipient.displayName ?? null,
      subject: rendered.subject ?? null,
      body: rendered.body,
      variables: params.variables,
      status: "pending_approval",
    })
    .returning({ id: outboundMessages.id });
  await logActivity(tx, {
    tenantId: params.tenantId,
    actorKind: "system",
    subjectKind: "task",
    subjectId: params.taskId,
    event: "message_queued",
    meta: {
      channel: params.channel,
      templateKey: params.templateKey,
      recipientKind: params.recipient.kind,
      outboundMessageId: row?.id ?? null,
    },
  });
  return Boolean(row);
}

export type PendingOutboundMessage = {
  id: string;
  taskId: string | null;
  channel: string;
  templateKey: string;
  recipientKind: "internal_user" | "participant" | "employer";
  recipientName: string | null;
  recipientPhone: string | null;
  recipientEmail: string | null;
  subject: string | null;
  body: string;
  createdAt: Date;
};

/** Lists the tenant's messages awaiting a human decision, newest first. */
export async function listPendingMessages(
  tx: DbHandle,
): Promise<PendingOutboundMessage[]> {
  return tx
    .select({
      id: outboundMessages.id,
      taskId: outboundMessages.taskId,
      channel: outboundMessages.channel,
      templateKey: outboundMessages.templateKey,
      recipientKind: outboundMessages.recipientKind,
      recipientName: outboundMessages.recipientName,
      recipientPhone: outboundMessages.recipientPhone,
      recipientEmail: outboundMessages.recipientEmail,
      subject: outboundMessages.subject,
      body: outboundMessages.body,
      createdAt: outboundMessages.createdAt,
    })
    .from(outboundMessages)
    .where(eq(outboundMessages.status, "pending_approval"))
    .orderBy(desc(outboundMessages.createdAt));
}

export type ApproveOutcome =
  | "dispatched"
  | "failed"
  | "not_found"
  | "not_pending";

export type ApproveMessageParams = {
  tenantId: string;
  messageId: string;
  approvedByUserId: string;
  // Injectable for tests; defaults to the real per-channel adapter.
  adapter?: ChannelAdapter;
};

/**
 * The ONLY path that actually dispatches a system message. Loads a pending row
 * (tenant-scoped), records the human approval, then transitions
 * approved→sending→sent/failed while calling the live/mock adapter. On success
 * it mirrors the provider message id into message_deliveries so a webhook
 * receipt can reconcile delivery state. Every step emits an honest audit event.
 */
export async function approveAndDispatch(
  tx: DbHandle,
  params: ApproveMessageParams,
): Promise<ApproveOutcome> {
  const [row] = await tx
    .select()
    .from(outboundMessages)
    .where(
      and(
        eq(outboundMessages.id, params.messageId),
        eq(outboundMessages.tenantId, params.tenantId),
      ),
    );
  if (!row) return "not_found";
  if (!canApprove(row.status)) return "not_pending";

  const now = new Date();
  await tx
    .update(outboundMessages)
    .set({
      status: "sending",
      approvedByUserId: params.approvedByUserId,
      approvedAt: now,
    })
    .where(eq(outboundMessages.id, row.id));
  await logActivity(tx, {
    tenantId: params.tenantId,
    actorKind: "internal_user",
    actorUserId: params.approvedByUserId,
    subjectKind: "task",
    subjectId: row.taskId ?? row.id,
    event: "message_approved",
    meta: {
      channel: row.channel,
      templateKey: row.templateKey,
      outboundMessageId: row.id,
    },
  });

  const channel = row.channel as MessageChannel;
  const recipient: Recipient = {
    // System outbound messages only ever target external owners; the column
    // shares the owner_kind enum (which also has internal_user), so narrow it.
    kind: row.recipientKind as "participant" | "employer",
    id: row.recipientId,
    phone: row.recipientPhone,
    email: row.recipientEmail,
    displayName: row.recipientName,
  };
  const adapter = params.adapter ?? getAdapter(channel);
  const result = await adapter.send({
    tenantId: params.tenantId,
    channel,
    recipient,
    subject: row.subject ?? undefined,
    body: row.body,
    templateKey: row.templateKey,
    taskId: row.taskId ?? undefined,
    variables: row.variables ?? undefined,
  });

  const nextStatus = statusForSendResult(result.ok);
  await tx
    .update(outboundMessages)
    .set({
      status: nextStatus,
      providerMessageId: result.ok ? result.providerMessageId ?? null : null,
      errorDetail: result.ok ? null : result.error,
      sentAt: result.ok ? new Date() : null,
      failedAt: result.ok ? null : new Date(),
    })
    .where(eq(outboundMessages.id, row.id));

  if (result.ok && result.providerMessageId) {
    await recordOutboundDelivery(tx, {
      tenantId: params.tenantId,
      taskId: row.taskId ?? undefined,
      channel,
      providerMessageId: result.providerMessageId,
      recipient,
    });
  }

  await logActivity(tx, {
    tenantId: params.tenantId,
    actorKind: "internal_user",
    actorUserId: params.approvedByUserId,
    subjectKind: "task",
    subjectId: row.taskId ?? row.id,
    event: result.ok ? "message_dispatched" : "message_dispatch_failed",
    meta: {
      channel: row.channel,
      templateKey: row.templateKey,
      recipientKind: row.recipientKind,
      outboundMessageId: row.id,
    },
  });

  return result.ok ? "dispatched" : "failed";
}

export type RejectOutcome = "rejected" | "not_found" | "not_pending";

export type RejectMessageParams = {
  tenantId: string;
  messageId: string;
  rejectedByUserId: string;
  reason?: string;
};

/** Human rejection of a pending message — it is never dispatched. */
export async function rejectOutboundMessage(
  tx: DbHandle,
  params: RejectMessageParams,
): Promise<RejectOutcome> {
  const [row] = await tx
    .select({
      id: outboundMessages.id,
      status: outboundMessages.status,
      taskId: outboundMessages.taskId,
      channel: outboundMessages.channel,
      templateKey: outboundMessages.templateKey,
    })
    .from(outboundMessages)
    .where(
      and(
        eq(outboundMessages.id, params.messageId),
        eq(outboundMessages.tenantId, params.tenantId),
      ),
    );
  if (!row) return "not_found";
  if (!canReject(row.status)) return "not_pending";

  await tx
    .update(outboundMessages)
    .set({
      status: "rejected",
      rejectedByUserId: params.rejectedByUserId,
      rejectedAt: new Date(),
      rejectionReason: params.reason ?? null,
    })
    .where(eq(outboundMessages.id, row.id));
  await logActivity(tx, {
    tenantId: params.tenantId,
    actorKind: "internal_user",
    actorUserId: params.rejectedByUserId,
    subjectKind: "task",
    subjectId: row.taskId ?? row.id,
    event: "message_rejected",
    meta: {
      channel: row.channel,
      templateKey: row.templateKey,
      outboundMessageId: row.id,
    },
  });
  return "rejected";
}

export type CancelOutcome = "cancelled" | "not_found" | "not_cancellable";

export type CancelMessageParams = {
  tenantId: string;
  messageId: string;
  cancelledByUserId: string;
};

/** Cancels a pending or approved-but-undispatched message. */
export async function cancelOutboundMessage(
  tx: DbHandle,
  params: CancelMessageParams,
): Promise<CancelOutcome> {
  const [row] = await tx
    .select({
      id: outboundMessages.id,
      status: outboundMessages.status,
      taskId: outboundMessages.taskId,
      channel: outboundMessages.channel,
      templateKey: outboundMessages.templateKey,
    })
    .from(outboundMessages)
    .where(
      and(
        eq(outboundMessages.id, params.messageId),
        eq(outboundMessages.tenantId, params.tenantId),
      ),
    );
  if (!row) return "not_found";
  if (!canCancel(row.status)) return "not_cancellable";

  await tx
    .update(outboundMessages)
    .set({ status: "cancelled" })
    .where(eq(outboundMessages.id, row.id));
  await logActivity(tx, {
    tenantId: params.tenantId,
    actorKind: "internal_user",
    actorUserId: params.cancelledByUserId,
    subjectKind: "task",
    subjectId: row.taskId ?? row.id,
    event: "message_cancelled",
    meta: {
      channel: row.channel,
      templateKey: row.templateKey,
      outboundMessageId: row.id,
    },
  });
  return "cancelled";
}
