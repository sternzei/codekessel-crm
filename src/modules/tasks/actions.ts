"use server";

import { and, desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { consentRecords, employers, tasks } from "@/db/schema";
import { logActivity } from "@/modules/audit/log";
import { getSession } from "@/modules/auth/session";
import { resolveAdapterMode } from "@/modules/messaging/adapters";
import { resolveRecipient, sendTaskMessage } from "@/modules/messaging/send";
import { normalizePhone } from "@/modules/participants/phone";
import {
  getOrIssueMagicLinkForTask,
  issueMagicLink,
} from "@/modules/tokens/service";

/**
 * Re-issues a magic link for an external task. Tokens are stored only as
 * hashes, so a "lost" link cannot be recovered — consultants mint a fresh
 * one instead (the old token stays valid until it expires or is used).
 */
export async function issueLinkForTask(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/auth/sign-in");

  const taskId = z.string().uuid().parse(formData.get("taskId"));

  const url = await withTenant(session.tenantId, async (tx) => {
    const [task] = await tx.select().from(tasks).where(eq(tasks.id, taskId));
    if (!task || task.ownerKind === "internal_user") return null;

    const subjectId =
      task.ownerKind === "participant"
        ? task.ownerParticipantId
        : task.ownerEmployerId;
    if (!subjectId) return null;

    const link = await issueMagicLink(tx, {
      tenantId: session.tenantId,
      taskId: task.id,
      subjectKind: task.ownerKind,
      subjectId,
      scope: task.type,
    });

    await logActivity(tx, {
      tenantId: session.tenantId,
      actorKind: "internal_user",
      actorUserId: session.id,
      subjectKind: "task",
      subjectId: task.id,
      event: "link_issued",
    });
    return link.url;
  });

  redirect(url ? `/tasks?link=${encodeURIComponent(url)}` : "/tasks");
}

// Manual-send outcomes surfaced back to the tasks page via ?wa=<outcome>.
type WhatsAppSendOutcome =
  | "ok"
  | "no_phone"
  | "no_consent"
  | "not_applicable"
  | "failed";

/**
 * True when the participant has a current WhatsApp opt-in. Consent is
 * append-only (withdrawal = a new granted=false row), so the LATEST
 * whatsapp_optin record wins.
 */
async function hasWhatsAppOptIn(
  tx: Parameters<typeof resolveRecipient>[0],
  participantId: string,
): Promise<boolean> {
  const [latest] = await tx
    .select({ granted: consentRecords.granted })
    .from(consentRecords)
    .where(
      and(
        eq(consentRecords.participantId, participantId),
        eq(consentRecords.kind, "whatsapp_optin"),
      ),
    )
    .orderBy(desc(consentRecords.grantedAt))
    .limit(1);
  return latest?.granted === true;
}

/**
 * Sends a task's message over WhatsApp from the internal console. Tenant-scoped
 * and session-guarded like every other task action. Resolves the recipient,
 * requires a phone, and — only in LIVE mode — requires a WhatsApp opt-in for
 * participant recipients. In demo/mock mode the MockAdapter just logs, so no
 * consent is required and no network call is made. Reuses sendTaskMessage +
 * the existing `task_<type>` templates (no new template infrastructure).
 */
export async function sendTaskWhatsApp(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/auth/sign-in");

  const taskId = z.string().uuid().parse(formData.get("taskId"));

  const outcome = await withTenant<WhatsAppSendOutcome>(
    session.tenantId,
    async (tx) => {
      const [task] = await tx.select().from(tasks).where(eq(tasks.id, taskId));
      if (!task || task.ownerKind === "internal_user") return "not_applicable";

      const ownerKind = task.ownerKind;
      const subjectId =
        ownerKind === "participant"
          ? task.ownerParticipantId
          : task.ownerEmployerId;
      if (!subjectId) return "not_applicable";

      const recipient = await resolveRecipient(tx, ownerKind, subjectId);
      if (!recipient) return "not_applicable";
      if (!normalizePhone({ raw: recipient.phone }).normalized) {
        return "no_phone";
      }

      // Consent gate only bites in LIVE mode and only for participants (the
      // opt-in is captured on the participant consent flow). Demo stays open.
      if (
        resolveAdapterMode("whatsapp") === "live" &&
        ownerKind === "participant" &&
        !(await hasWhatsAppOptIn(tx, subjectId))
      ) {
        return "no_consent";
      }

      // F3: magic-link tasks must carry a working /t/{jwt} link. Only the hash
      // is stored, so we mint a fresh one (superseding any live token). Non
      // magic-link tasks get no link — their templates don't reference {{link}}.
      const link =
        task.channel === "magic_link"
          ? await getOrIssueMagicLinkForTask(tx, task)
          : null;

      const ok = await sendTaskMessage(tx, {
        tenantId: session.tenantId,
        taskId: task.id,
        channel: "whatsapp",
        templateKey: `task_${task.type}`,
        recipient,
        variables: {
          firstName: recipient.displayName ?? "",
          title: task.title,
          ...(link ? { link } : {}),
        },
      });

      await logActivity(tx, {
        tenantId: session.tenantId,
        actorKind: "internal_user",
        actorUserId: session.id,
        subjectKind: "task",
        subjectId: task.id,
        event: "whatsapp_manual_sent",
        meta: { ok, recipientKind: ownerKind },
      });

      return ok ? "ok" : "failed";
    },
  );

  redirect(`/tasks?wa=${outcome}`);
}

/**
 * Starts the employer setup assistant: creates the employer_setup task and
 * mints its magic link for the consultant to send or copy.
 */
export async function createEmployerSetupLink(
  formData: FormData,
): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/auth/sign-in");

  const employerId = z.string().uuid().parse(formData.get("employerId"));

  const url = await withTenant(session.tenantId, async (tx) => {
    const [employer] = await tx
      .select({ id: employers.id })
      .from(employers)
      .where(eq(employers.id, employerId));
    if (!employer) return null;

    const [task] = await tx
      .insert(tasks)
      .values({
        tenantId: session.tenantId,
        type: "employer_setup",
        title: "Unternehmensangaben vervollständigen",
        status: "open",
        ownerKind: "employer",
        ownerEmployerId: employerId,
        channel: "magic_link",
        subjectKind: "employer",
        subjectId: employerId,
        dueAt: new Date(Date.now() + 72 * 3_600_000),
        escalationAt: new Date(Date.now() + 120 * 3_600_000),
      })
      .returning({ id: tasks.id });

    const link = await issueMagicLink(tx, {
      tenantId: session.tenantId,
      taskId: task.id,
      subjectKind: "employer",
      subjectId: employerId,
      scope: "employer_setup",
    });

    await logActivity(tx, {
      tenantId: session.tenantId,
      actorKind: "internal_user",
      actorUserId: session.id,
      subjectKind: "task",
      subjectId: task.id,
      event: "task_created",
      meta: { taskType: "employer_setup" },
    });
    return link.url;
  });

  redirect(url ? `/employers?link=${encodeURIComponent(url)}` : "/employers");
}
