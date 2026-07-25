"use server";

import { and, desc, eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { consentRecords, employers, tasks } from "@/db/schema";
import { logActivity } from "@/modules/audit/log";
import { getSession } from "@/modules/auth/session";
import { resolveAdapterMode } from "@/modules/messaging/adapters";
import { buildWaMeUrl, toWaMeNumber } from "@/modules/messaging/click-to-chat";
import { resolveRecipient, sendTaskMessage } from "@/modules/messaging/send";
import { renderTemplate } from "@/modules/messaging/templates";
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

// Result of building a WhatsApp click-to-chat deep link. Returned (not
// redirected) because the caller is a client component that opens the URL.
type WhatsAppClickToChatResult =
  | { ok: true; url: string }
  | { ok: false; reason: "no_phone" | "not_applicable" | "failed" };

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

    // magic-link tasks carry a freshly minted /t/{jwt}; other task types have
    // no {{link}} placeholder in their template.
    const link =
      task.channel === "magic_link"
        ? await getOrIssueMagicLinkForTask(tx, task)
        : null;

    const rendered = await renderTemplate(tx, `task_${task.type}`, "whatsapp", {
      firstName: recipient.displayName ?? "",
      title: task.title,
      ...(link ? { link } : {}),
    });

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
