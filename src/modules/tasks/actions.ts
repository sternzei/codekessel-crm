"use server";

import { and, desc, eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { consentRecords, employers, tasks } from "@/db/schema";
import { logActivity } from "@/modules/audit/log";
import { logger } from "@/lib/logger";
import { canManageTenantRecords } from "@/modules/auth/authorization";
import { resolveTaskWriteAccess } from "@/modules/auth/task-scope";
import { getSession } from "@/modules/auth/session";
import { resolveAdapterMode } from "@/modules/messaging/adapters";
import { buildWaMeUrl, toWaMeNumber } from "@/modules/messaging/click-to-chat";
import { enqueueAndDispatchManual } from "@/modules/messaging/outbox";
import { resolveRecipient } from "@/modules/messaging/send";
import { buildTaskTemplateKey, hasLandingPage } from "@/modules/messaging/catalog";
import { isTemplateRenderError, renderTemplate } from "@/modules/messaging/templates";
import { normalizePhone } from "@/modules/participants/phone";
import {
  getOrIssueMagicLinkForTask,
  issueMagicLink,
  listLiveTokenIdsForTask,
  revokeToken,
} from "@/modules/tokens/service";

/**
 * Re-issues a magic link for an external task. Tokens are stored only as
 * hashes, so a "lost" link cannot be recovered — consultants mint a fresh
 * one instead. Re-issuing supersedes any still-live token for the task
 * (getOrIssueMagicLinkForTask) so only one credential is ever valid.
 */
export async function issueLinkForTask(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/auth/sign-in");

  const taskId = z.string().uuid().parse(formData.get("taskId"));

  const url = await withTenant(session.tenantId, async (tx) => {
    const access = await resolveTaskWriteAccess(tx, taskId, {
      userId: session.id,
      role: session.role,
    });
    if (access !== "allowed") redirect(`/tasks?access=${access}`);
    const [task] = await tx.select().from(tasks).where(eq(tasks.id, taskId));
    if (!task) return null;

    const link = await getOrIssueMagicLinkForTask(tx, task);
    if (!link) return null;

    await logActivity(tx, {
      tenantId: session.tenantId,
      actorKind: "internal_user",
      actorUserId: session.id,
      subjectKind: "task",
      subjectId: task.id,
      event: "link_issued",
    });
    return link;
  });

  redirect(url ? `/tasks?link=${encodeURIComponent(url)}` : "/tasks");
}

/**
 * Consultant-facing manual revoke: invalidates a task's still-live magic
 * link(s) so a mis-sent or compromised link stops working immediately (without
 * waiting for expiry or task completion). Tenant-scoped + session-guarded like
 * every internal action. Each live token is revoked individually via
 * `revokeToken` (mirrors the automatic bulk `revokeUnusedTokensForTask` run on
 * completion) and the revocation is written to the audit trail. The count is
 * surfaced back to the tasks page via ?revoked=<n>.
 */
export async function revokeTaskLink(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/auth/sign-in");

  const taskId = z.string().uuid().parse(formData.get("taskId"));

  const revokedCount = await withTenant(session.tenantId, async (tx) => {
    const access = await resolveTaskWriteAccess(tx, taskId, {
      userId: session.id,
      role: session.role,
    });
    if (access !== "allowed") redirect(`/tasks?access=${access}`);
    const [task] = await tx.select().from(tasks).where(eq(tasks.id, taskId));
    if (!task) return 0;

    const liveTokenIds = await listLiveTokenIdsForTask(tx, task.id);
    for (const tokenId of liveTokenIds) {
      await revokeToken(tx, tokenId);
    }

    if (liveTokenIds.length > 0) {
      await logActivity(tx, {
        tenantId: session.tenantId,
        actorKind: "internal_user",
        actorUserId: session.id,
        subjectKind: "task",
        subjectId: task.id,
        event: "link_revoked",
        meta: { count: liveTokenIds.length },
      });
    }
    return liveTokenIds.length;
  });

  redirect(`/tasks?revoked=${revokedCount}`);
}

// Manual-send outcomes surfaced back via a redirect. "sent" means the Cloud
// API path already dispatched (the consultant click is the approval).
type WhatsAppSendOutcome =
  | "sent"
  | "cloud_unavailable"
  | "no_phone"
  | "no_consent"
  | "must_claim"
  | "forbidden"
  | "not_applicable"
  | "no_template"
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
 * Sends a task's WhatsApp message immediately via the business Cloud API
 * number. Tenant-scoped and session-guarded. Resolves the recipient, requires
 * a phone, and — only in LIVE mode — requires a WhatsApp opt-in for participant
 * recipients. The consultant click IS the human approval: this path does not
 * wait in Postausgang (that gate remains for system-queued messages only).
 * Mints a fresh magic link when the task channel needs one.
 */
export async function sendTaskWhatsApp(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/auth/sign-in");

  const taskId = z.string().uuid().parse(formData.get("taskId"));

  // Until Meta Cloud API credentials are configured, refuse the "Firmennummer"
  // path — the UI uses click-to-chat instead. Never report a mock send as sent.
  if (resolveAdapterMode("whatsapp") !== "live") {
    redirect("/tasks?wa=cloud_unavailable");
  }

  const prepared = await withTenant(
    session.tenantId,
    async (tx) => {
      const access = await resolveTaskWriteAccess(tx, taskId, {
        userId: session.id,
        role: session.role,
      });
      if (access !== "allowed") {
        return { outcome: access as WhatsAppSendOutcome } as const;
      }
      const [task] = await tx.select().from(tasks).where(eq(tasks.id, taskId));
      if (!task || task.ownerKind === "internal_user") {
        return { outcome: "not_applicable" as const };
      }

      const ownerKind = task.ownerKind;
      const subjectId =
        ownerKind === "participant"
          ? task.ownerParticipantId
          : task.ownerEmployerId;
      if (!subjectId) return { outcome: "not_applicable" as const };

      const recipient = await resolveRecipient(tx, ownerKind, subjectId);
      if (!recipient) return { outcome: "not_applicable" as const };
      if (!normalizePhone({ raw: recipient.phone }).normalized) {
        return { outcome: "no_phone" as const };
      }

      // Consent gate only bites in LIVE mode and only for participants (the
      // opt-in is captured on the participant consent flow). Demo stays open.
      if (
        resolveAdapterMode("whatsapp") === "live" &&
        ownerKind === "participant" &&
        !(await hasWhatsAppOptIn(tx, subjectId))
      ) {
        return { outcome: "no_consent" as const };
      }

      // F3: tasks whose type has a /t/[token] page must carry a working link.
      // Only the hash is stored, so we mint a fresh one (superseding any live
      // token). Task types without a landing page get none — their templates
      // don't reference {{link}}.
      const link = hasLandingPage(task.type)
        ? await getOrIssueMagicLinkForTask(tx, task)
        : null;

      return {
        outcome: "ready" as const,
        taskId: task.id,
        ownerKind,
        recipient,
        templateKey: buildTaskTemplateKey(task.type),
        variables: {
          firstName: recipient.displayName ?? "",
          title: task.title,
          ...(link ? { link } : {}),
        },
      };
    },
  );

  if (prepared.outcome !== "ready") {
    redirect(`/tasks?wa=${prepared.outcome}`);
  }

  let dispatchOutcome: "dispatched" | "failed";
  try {
    dispatchOutcome = await enqueueAndDispatchManual({
      tenantId: session.tenantId,
      taskId: prepared.taskId,
      channel: "whatsapp",
      templateKey: prepared.templateKey,
      recipient: prepared.recipient,
      actorUserId: session.id,
      variables: prepared.variables,
    });
  } catch (error: unknown) {
    // A missing or broken template is a configuration fault, not a transport
    // failure: tell the consultant instead of sending improvised copy.
    if (!isTemplateRenderError(error)) throw error;
    logger.error("manual whatsapp send blocked by template", {
      taskId: prepared.taskId,
      templateKey: error.templateKey,
      channel: error.channel,
    });
    redirect("/tasks?wa=no_template");
  }

  await withTenant(session.tenantId, async (tx) => {
    await logActivity(tx, {
      tenantId: session.tenantId,
      actorKind: "internal_user",
      actorUserId: session.id,
      subjectKind: "task",
      subjectId: prepared.taskId,
      event:
        dispatchOutcome === "dispatched"
          ? "whatsapp_manual_sent"
          : "whatsapp_manual_failed",
      meta: {
        recipientKind: prepared.ownerKind,
        outbound: dispatchOutcome,
      },
    });
  });

  redirect(
    dispatchOutcome === "dispatched" ? "/tasks?wa=sent" : "/tasks?wa=failed",
  );
}

// Result of building a WhatsApp click-to-chat deep link. Returned (not
// redirected) because the caller is a client component that opens the URL.
type WhatsAppClickToChatResult =
  | { ok: true; url: string }
  | {
      ok: false;
      reason:
        | "no_phone"
        | "not_applicable"
        | "must_claim"
        | "forbidden"
        | "no_template"
        | "failed";
    };

/**
 * Builds a WhatsApp *click-to-chat* (wa.me) deep link for a task so the
 * consultant can open WhatsApp Web / the app and send the prefilled message
 * from their OWN account. Unlike {@link sendTaskWhatsApp} (the automated
 * Business-API path) this never dispatches anything: click-to-chat cannot
 * confirm a send, so we only log that WhatsApp was *opened*.
 *
 * Tenant-scoped + session-guarded like every task action. Resolves the
 * recipient, requires a phone, mints a fresh magic link for magic_link tasks
 * (only the hash is stored, so we always re-issue, superseding any live token),
 * renders the existing `task_<type>` template body (with the link), and returns
 * the wa.me URL. No consent gate: opening a draft is the consultant's own
 * manual action, not a business-initiated automated send.
 */
export async function buildWhatsAppClickToChat(
  taskId: string,
): Promise<WhatsAppClickToChatResult> {
  const session = await getSession();
  if (!session) redirect("/auth/sign-in");

  const parsedTaskId = z.string().uuid().parse(taskId);

  return withTenant<WhatsAppClickToChatResult>(session.tenantId, async (tx) => {
    const access = await resolveTaskWriteAccess(tx, parsedTaskId, {
      userId: session.id,
      role: session.role,
    });
    if (access !== "allowed") return { ok: false, reason: access };
    const [task] = await tx.select().from(tasks).where(eq(tasks.id, parsedTaskId));
    if (!task || task.ownerKind === "internal_user") {
      return { ok: false, reason: "not_applicable" };
    }

    const ownerKind = task.ownerKind;
    const subjectId =
      ownerKind === "participant"
        ? task.ownerParticipantId
        : task.ownerEmployerId;
    if (!subjectId) return { ok: false, reason: "not_applicable" };

    const recipient = await resolveRecipient(tx, ownerKind, subjectId);
    if (!recipient) return { ok: false, reason: "not_applicable" };

    const phone = toWaMeNumber(recipient.phone ?? "");
    if (!phone) return { ok: false, reason: "no_phone" };

    // Task types with a /t/[token] page carry a freshly minted link; the others
    // have no {{link}} placeholder in their template.
    const link = hasLandingPage(task.type)
      ? await getOrIssueMagicLinkForTask(tx, task)
      : null;

    let rendered;
    try {
      rendered = await renderTemplate(
        tx,
        buildTaskTemplateKey(task.type),
        "whatsapp",
        {
          firstName: recipient.displayName ?? "",
          title: task.title,
          ...(link ? { link } : {}),
        },
      );
    } catch (error: unknown) {
      if (!isTemplateRenderError(error)) throw error;
      logger.error("click-to-chat blocked by template", {
        taskId: task.id,
        templateKey: error.templateKey,
        channel: error.channel,
      });
      return { ok: false, reason: "no_template" };
    }

    const url = buildWaMeUrl({ phone, text: rendered.body });

    // Honest audit: we can only prove the consultant OPENED WhatsApp with a
    // prefilled draft — never that a message was actually delivered.
    await logActivity(tx, {
      tenantId: session.tenantId,
      actorKind: "internal_user",
      actorUserId: session.id,
      subjectKind: "task",
      subjectId: task.id,
      event: "whatsapp_click_to_chat_opened",
      meta: { recipientKind: ownerKind, hasLink: Boolean(link) },
    });

    return { ok: true, url };
  });
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
  if (!canManageTenantRecords(session.role)) redirect("/employers?forbidden=1");

  const employerId = z.string().uuid().parse(formData.get("employerId"));

  const url = await withTenant(session.tenantId, async (tx) => {
    const [employer] = await tx
      .select({ id: employers.id })
      .from(employers)
      .where(eq(employers.id, employerId));
    if (!employer) return null;

    // Reuse an already-open setup task instead of stacking duplicates —
    // repeated clicks just re-mint the link (superseding the old token).
    const [existing] = await tx
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.tenantId, session.tenantId),
          eq(tasks.type, "employer_setup"),
          eq(tasks.ownerEmployerId, employerId),
          inArray(tasks.status, ["open", "in_progress", "waiting"]),
        ),
      )
      .limit(1);
    if (existing) {
      return getOrIssueMagicLinkForTask(tx, existing);
    }

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
      .onConflictDoNothing()
      .returning({ id: tasks.id });

    // Lost a concurrent-create race → reuse the winner's task.
    if (!task) {
      const [winner] = await tx
        .select()
        .from(tasks)
        .where(
          and(
            eq(tasks.tenantId, session.tenantId),
            eq(tasks.type, "employer_setup"),
            eq(tasks.ownerEmployerId, employerId),
            inArray(tasks.status, ["open", "in_progress", "waiting"]),
          ),
        )
        .orderBy(desc(tasks.createdAt))
        .limit(1);
      return winner ? getOrIssueMagicLinkForTask(tx, winner) : null;
    }

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
