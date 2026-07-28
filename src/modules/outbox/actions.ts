"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { getSession } from "@/modules/auth/session";
import {
  approveAndDispatch,
  cancelOutboundMessage,
  rejectOutboundMessage,
} from "@/modules/messaging/outbox";

const REJECTION_REASON_MAX = 500;

/**
 * Approves a pending outbound message and performs the actual provider dispatch
 * (the ONLY code path that sends a system message). Session-guarded and
 * tenant-scoped: RLS + the tenant filter ensure a user can only approve their
 * own tenant's rows. Redirects back to the Postausgang with the outcome.
 */
export async function approveMessage(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/auth/sign-in");
  const messageId = z.string().uuid().parse(formData.get("messageId"));
  const outcome = await approveAndDispatch({
    tenantId: session.tenantId,
    messageId,
    approvedByUserId: session.id,
    approverRole: session.role,
  });
  redirect(`/outbox?result=${outcome}`);
}

/** Rejects a pending outbound message so it is never dispatched. */
export async function rejectMessage(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/auth/sign-in");
  const messageId = z.string().uuid().parse(formData.get("messageId"));
  const reason = z
    .string()
    .max(REJECTION_REASON_MAX)
    .optional()
    .parse(formData.get("reason")?.toString() || undefined);
  const outcome = await withTenant(session.tenantId, (tx) =>
    rejectOutboundMessage(tx, {
      tenantId: session.tenantId,
      messageId,
      rejectedByUserId: session.id,
      rejectorRole: session.role,
      reason,
    }),
  );
  redirect(`/outbox?result=${outcome}`);
}

/** Cancels a pending or approved-but-undispatched outbound message. */
export async function cancelMessage(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/auth/sign-in");
  const messageId = z.string().uuid().parse(formData.get("messageId"));
  const outcome = await withTenant(session.tenantId, (tx) =>
    cancelOutboundMessage(tx, {
      tenantId: session.tenantId,
      messageId,
      cancelledByUserId: session.id,
      cancellerRole: session.role,
    }),
  );
  redirect(`/outbox?result=${outcome}`);
}
