import { and, desc, eq, inArray, lte, or } from "drizzle-orm";
import { withTenant, type DbHandle } from "@/db/client";
import { outboundMessages, tasks } from "@/db/schema";
import { logActivity } from "@/modules/audit/log";
import {
  canApproveCloudMessage,
  canManageTenantRecords,
  type AppRole,
  type ParticipantAccessContext,
} from "@/modules/auth/authorization";
import { buildTaskAccessCondition } from "@/modules/auth/task-scope";
import { getAdapter, resolveAdapterMode } from "./adapters";
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
  createdByUserId?: string;
};

type TenantRunner = <T>(
  tenantId: string,
  operation: (tx: DbHandle) => Promise<T>,
) => Promise<T>;

const defaultTenantRunner: TenantRunner = (tenantId, operation) =>
  withTenant(tenantId, operation);

/**
 * Approval gate entry point. Renders the message and writes ONE pending row to
 * the outbox instead of dispatching — nothing reaches the provider here.
 * System send paths (routing engine, reminder worker) funnel through this so
 * no *automated* outbound message is sent without a later human approve
 * action. Consultant-initiated sends use {@link enqueueAndDispatchManual}
 * instead (the click is the approval). Returns true once the pending row exists.
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
      createdByUserId: params.createdByUserId ?? null,
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

export type ImmediateDispatchSource = "manual_send" | "routing" | "reminder";

export type ImmediateDispatchParams = EnqueueTaskMessageParams & {
  readonly actorUserId?: string | null;
  readonly source: ImmediateDispatchSource;
  readonly adapter?: ChannelAdapter;
};

export type ManualDispatchParams = EnqueueTaskMessageParams & {
  readonly actorUserId: string;
  readonly adapter?: ChannelAdapter;
  readonly runWithTenant?: TenantRunner;
};

export type ManualDispatchOutcome = "dispatched" | "failed";

/**
 * Immediate Cloud API / email dispatch on an existing DB handle (tenant tx or
 * owner connection). The human or system trigger that called this IS the
 * approval — the row never waits in Postausgang. Used by consultant manual
 * send, routing-engine follow-ups, and reminder jobs.
 */
export async function enqueueAndDispatchOnHandle(
  tx: DbHandle,
  params: ImmediateDispatchParams,
): Promise<ManualDispatchOutcome> {
  const rendered = await renderTemplate(
    tx,
    params.templateKey,
    params.channel,
    params.variables,
  );
  const now = new Date();
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
      status: "sending",
      createdByUserId: params.actorUserId ?? null,
      approvedByUserId: params.actorUserId ?? null,
      approvedAt: now,
    })
    .returning({
      id: outboundMessages.id,
      taskId: outboundMessages.taskId,
      channel: outboundMessages.channel,
      templateKey: outboundMessages.templateKey,
      recipientKind: outboundMessages.recipientKind,
      recipientId: outboundMessages.recipientId,
      recipientPhone: outboundMessages.recipientPhone,
      recipientEmail: outboundMessages.recipientEmail,
      recipientName: outboundMessages.recipientName,
      subject: outboundMessages.subject,
      body: outboundMessages.body,
      variables: outboundMessages.variables,
    });
  if (!row) return "failed";
  await logActivity(tx, {
    tenantId: params.tenantId,
    actorKind: params.actorUserId ? "internal_user" : "system",
    actorUserId: params.actorUserId ?? undefined,
    subjectKind: "task",
    subjectId: params.taskId,
    event: "message_approved",
    meta: {
      channel: params.channel,
      templateKey: params.templateKey,
      outboundMessageId: row.id,
      source: params.source,
    },
  });
  const channel = row.channel as MessageChannel;
  const recipient: Recipient = {
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
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(outboundMessages.id, row.id),
        eq(outboundMessages.tenantId, params.tenantId),
        eq(outboundMessages.status, "sending"),
      ),
    );
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
    actorKind: params.actorUserId ? "internal_user" : "system",
    actorUserId: params.actorUserId ?? undefined,
    subjectKind: "task",
    subjectId: row.taskId ?? row.id,
    event: result.ok ? "message_dispatched" : "message_dispatch_failed",
    meta: {
      channel: row.channel,
      templateKey: row.templateKey,
      recipientKind: row.recipientKind,
      outboundMessageId: row.id,
      source: params.source,
      // Without provider credentials the adapter is a mock that reports
      // success, so "gesendet" alone cannot be trusted. Record which it was.
      mode: resolveAdapterMode(channel),
    },
  });
  return result.ok ? "dispatched" : "failed";
}

/**
 * Consultant-initiated Cloud API send. The button click IS the human approval,
 * so this path does not wait in Postausgang and does not apply SoD.
 */
export async function enqueueAndDispatchManual(
  params: ManualDispatchParams,
): Promise<ManualDispatchOutcome> {
  const runWithTenant = params.runWithTenant ?? defaultTenantRunner;
  return runWithTenant(params.tenantId, (tx) =>
    enqueueAndDispatchOnHandle(tx, {
      ...params,
      source: "manual_send",
      actorUserId: params.actorUserId,
    }),
  );
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
  createdByUserId: string | null;
  createdAt: Date;
};

export type StaleSendingMessage = {
  readonly id: string;
  readonly taskId: string | null;
  readonly updatedAt: Date;
};

export const isStaleSendingTimestamp = (
  updatedAt: Date,
  now: Date,
  thresholdMinutes: number,
): boolean =>
  updatedAt.getTime() <= now.getTime() - thresholdMinutes * 60 * 1000;

/**
 * Lists sends that need manual provider reconciliation. A sending row is never
 * automatically retried because the provider may already have accepted it.
 */
export const listStaleSendingMessages = async (
  tx: DbHandle,
  thresholdMinutes: number,
  now: Date = new Date(),
): Promise<StaleSendingMessage[]> => {
  const cutoff = new Date(now.getTime() - thresholdMinutes * 60 * 1000);
  return tx
    .select({
      id: outboundMessages.id,
      taskId: outboundMessages.taskId,
      updatedAt: outboundMessages.updatedAt,
    })
    .from(outboundMessages)
    .where(
      and(
        eq(outboundMessages.status, "sending"),
        lte(outboundMessages.updatedAt, cutoff),
      ),
    )
    .orderBy(outboundMessages.updatedAt);
};

/** Lists the tenant's messages awaiting a human decision, newest first. */
export async function listPendingMessages(
  tx: DbHandle,
  context: ParticipantAccessContext,
): Promise<PendingOutboundMessage[]> {
  const taskAccess = buildTaskAccessCondition(context);
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
      createdByUserId: outboundMessages.createdByUserId,
      createdAt: outboundMessages.createdAt,
    })
    .from(outboundMessages)
    .leftJoin(tasks, eq(outboundMessages.taskId, tasks.id))
    .where(
      and(
        eq(outboundMessages.status, "pending_approval"),
        canManageTenantRecords(context.role)
          ? undefined
          : or(
              eq(outboundMessages.createdByUserId, context.userId),
              taskAccess,
            ),
      ),
    )
    .orderBy(desc(outboundMessages.createdAt));
}

export type ApproveOutcome =
  | "dispatched"
  | "failed"
  | "not_found"
  | "not_pending"
  | "forbidden_role"
  | "self_approval";

export type ApproveMessageParams = {
  tenantId: string;
  messageId: string;
  approvedByUserId: string;
  approverRole: AppRole;
  // Injectable for tests; defaults to the real per-channel adapter.
  adapter?: ChannelAdapter;
  runWithTenant?: TenantRunner;
};

type ClaimApprovalResult =
  | { readonly outcome: ApproveOutcome; readonly row?: never }
  | {
      readonly outcome?: never;
      readonly row: typeof outboundMessages.$inferSelect;
    };

const logMessageDecisionDenied = async (
  tx: DbHandle,
  params: {
    readonly tenantId: string;
    readonly actorUserId: string;
    readonly taskId: string | null;
    readonly messageId: string;
    readonly action: "approve" | "reject" | "cancel";
    readonly reason: string;
  },
): Promise<void> => {
  await logActivity(tx, {
    tenantId: params.tenantId,
    actorKind: "internal_user",
    actorUserId: params.actorUserId,
    subjectKind: "task",
    subjectId: params.taskId ?? params.messageId,
    event: "message_decision_denied",
    meta: {
      action: params.action,
      reason: params.reason,
      outboundMessageId: params.messageId,
    },
  });
};

/**
 * The ONLY path that actually dispatches a system message. Loads a pending row
 * (tenant-scoped), atomically commits pending→sending, then calls the adapter
 * outside that transaction. Final status is recorded in a second short
 * transaction. A post-send persistence failure can leave a recoverable
 * `sending` row, but cannot roll the row back to pending and duplicate-send.
 */
export async function approveAndDispatch(
  params: ApproveMessageParams,
): Promise<ApproveOutcome> {
  const runWithTenant = params.runWithTenant ?? defaultTenantRunner;
  const claimed: ClaimApprovalResult = await runWithTenant(
    params.tenantId,
    async (tx) => {
      const [row] = await tx
        .select()
        .from(outboundMessages)
        .where(
          and(
            eq(outboundMessages.id, params.messageId),
            eq(outboundMessages.tenantId, params.tenantId),
          ),
        );
      if (!row) return { outcome: "not_found" as const };
      const approvalDecision = canApproveCloudMessage({
        approver: {
          userId: params.approvedByUserId,
          role: params.approverRole,
        },
        createdByUserId: row.createdByUserId,
      });
      const denialReason: ApproveOutcome | null = !canApprove(row.status)
        ? "not_pending"
        : approvalDecision === "allowed"
          ? null
          : approvalDecision;
      if (denialReason) {
        await logMessageDecisionDenied(tx, {
          tenantId: params.tenantId,
          actorUserId: params.approvedByUserId,
          taskId: row.taskId,
          messageId: row.id,
          action: "approve",
          reason: denialReason,
        });
        return { outcome: denialReason };
      }
      const now = new Date();
      const [locked] = await tx
        .update(outboundMessages)
        .set({
          status: "sending",
          approvedByUserId: params.approvedByUserId,
          approvedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(outboundMessages.id, row.id),
            eq(outboundMessages.tenantId, params.tenantId),
            eq(outboundMessages.status, "pending_approval"),
          ),
        )
        .returning();
      if (!locked) {
        await logMessageDecisionDenied(tx, {
          tenantId: params.tenantId,
          actorUserId: params.approvedByUserId,
          taskId: row.taskId,
          messageId: row.id,
          action: "approve",
          reason: "concurrent_not_pending",
        });
        return { outcome: "not_pending" as const };
      }
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
      return { row: locked };
    },
  );
  if (claimed.outcome) return claimed.outcome;
  const row = claimed.row;
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
  await runWithTenant(params.tenantId, async (tx) => {
    await tx
      .update(outboundMessages)
      .set({
        status: nextStatus,
        providerMessageId: result.ok ? result.providerMessageId ?? null : null,
        errorDetail: result.ok ? null : result.error,
        sentAt: result.ok ? new Date() : null,
        failedAt: result.ok ? null : new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(outboundMessages.id, row.id),
          eq(outboundMessages.tenantId, params.tenantId),
          eq(outboundMessages.status, "sending"),
        ),
      );
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
  });
  return result.ok ? "dispatched" : "failed";
}

export type RejectOutcome =
  | "rejected"
  | "not_found"
  | "not_pending"
  | "forbidden_role";

export type RejectMessageParams = {
  tenantId: string;
  messageId: string;
  rejectedByUserId: string;
  rejectorRole: AppRole;
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
  if (!canManageTenantRecords(params.rejectorRole)) {
    await logMessageDecisionDenied(tx, {
      tenantId: params.tenantId,
      actorUserId: params.rejectedByUserId,
      taskId: row.taskId,
      messageId: row.id,
      action: "reject",
      reason: "forbidden_role",
    });
    return "forbidden_role";
  }
  if (!canReject(row.status)) {
    await logMessageDecisionDenied(tx, {
      tenantId: params.tenantId,
      actorUserId: params.rejectedByUserId,
      taskId: row.taskId,
      messageId: row.id,
      action: "reject",
      reason: "not_pending",
    });
    return "not_pending";
  }

  const now = new Date();
  const [rejected] = await tx
    .update(outboundMessages)
    .set({
      status: "rejected",
      rejectedByUserId: params.rejectedByUserId,
      rejectedAt: now,
      rejectionReason: params.reason ?? null,
      updatedAt: now,
    })
    .where(
      and(
        eq(outboundMessages.id, row.id),
        eq(outboundMessages.tenantId, params.tenantId),
        eq(outboundMessages.status, "pending_approval"),
      ),
    )
    .returning();
  if (!rejected) return "not_pending";
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

export type CancelOutcome =
  | "cancelled"
  | "not_found"
  | "not_cancellable"
  | "forbidden_role";

export type CancelMessageParams = {
  tenantId: string;
  messageId: string;
  cancelledByUserId: string;
  cancellerRole: AppRole;
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
  if (!canManageTenantRecords(params.cancellerRole)) {
    await logMessageDecisionDenied(tx, {
      tenantId: params.tenantId,
      actorUserId: params.cancelledByUserId,
      taskId: row.taskId,
      messageId: row.id,
      action: "cancel",
      reason: "forbidden_role",
    });
    return "forbidden_role";
  }
  if (!canCancel(row.status)) {
    await logMessageDecisionDenied(tx, {
      tenantId: params.tenantId,
      actorUserId: params.cancelledByUserId,
      taskId: row.taskId,
      messageId: row.id,
      action: "cancel",
      reason: "not_cancellable",
    });
    return "not_cancellable";
  }

  const [cancelled] = await tx
    .update(outboundMessages)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(
      and(
        eq(outboundMessages.id, row.id),
        eq(outboundMessages.tenantId, params.tenantId),
        inArray(outboundMessages.status, ["pending_approval", "approved"]),
      ),
    )
    .returning();
  if (!cancelled) return "not_cancellable";
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
