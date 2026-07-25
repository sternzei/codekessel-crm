"use server";

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { withTenant } from "@/db/client";
import {
  appointments,
  consentRecords,
  documents,
  participants,
} from "@/db/schema";
import { requestClientIp } from "@/lib/client-ip";
import { extensionFor, sniffUploadType, type SniffedUploadType } from "@/lib/file-sniff";
import { logActivity } from "@/modules/audit/log";
import { normalizePhone } from "@/modules/participants/phone";
import { processTransition } from "@/modules/routing/engine";
import {
  completeTaskViaToken,
  loadTokenContext,
  verifyTokenSignature,
  type TokenValidation,
} from "@/modules/tokens/service";
import { isExternalActionThrottled } from "@/modules/tokens/request-throttle";

// External (magic-link) task actions for participants. Pattern per action:
// verify signature → tenant-scoped tx → validate token + scope → do the
// one thing → complete task + burn token → redirect to the done state.

type ValidCtx = Extract<TokenValidation, { ok: true }>;

async function requireCtx(
  tx: Parameters<typeof loadTokenContext>[0],
  token: string,
  scopes: string[],
): Promise<ValidCtx | null> {
  const ctx = await loadTokenContext(tx, token);
  if (!ctx.ok || !scopes.includes(ctx.tokenRow.scope)) return null;
  if (ctx.tokenRow.subjectKind !== "participant") return null;
  return ctx;
}

// ---------------------------------------------------------------------------
// Correct contact details (wrong number / unreachable flow)
// ---------------------------------------------------------------------------

const contactSchema = z.object({
  token: z.string().min(10),
  phone: z.string().trim().min(5).max(50),
  email: z.string().trim().email().optional().or(z.literal("")),
  street: z.string().trim().max(200).optional(),
  postalCode: z.string().trim().max(10).optional(),
  city: z.string().trim().max(100).optional(),
});

export async function updateContactDetails(formData: FormData): Promise<void> {
  if (await isExternalActionThrottled()) {
    redirect(`/t/${String(formData.get("token") ?? "")}?throttled=1`);
  }
  const parsed = contactSchema.safeParse({
    token: formData.get("token"),
    phone: formData.get("phone"),
    email: formData.get("email") ?? "",
    street: formData.get("street") ?? undefined,
    postalCode: formData.get("postalCode") ?? undefined,
    city: formData.get("city") ?? undefined,
  });
  if (!parsed.success) return;
  const input = parsed.data;

  const signature = await verifyTokenSignature(input.token);
  if (!signature) redirect(`/t/${input.token}`);

  const ok = await withTenant(signature.tenantId, async (tx) => {
    const ctx = await requireCtx(tx, input.token, [
      "request_correct_contact",
      "confirm_reachability",
    ]);
    if (!ctx) return false;

    const [participant] = await tx
      .select()
      .from(participants)
      .where(eq(participants.id, ctx.tokenRow.subjectId));
    if (!participant) return false;

    // Burn FIRST: the atomic gate. A concurrent double-submit loses here and
    // performs no side effects at all; anything below runs exactly once.
    if (!(await completeTaskViaToken(tx, ctx))) return false;

    await tx
      .update(participants)
      .set({
        phone: input.phone,
        phoneNormalized: normalizePhone({ raw: input.phone }).normalized,
        email: input.email || participant.email,
        street: input.street || participant.street,
        postalCode: input.postalCode || participant.postalCode,
        city: input.city || participant.city,
      })
      .where(eq(participants.id, participant.id));

    // Non-enum transition key: routes a fresh call task to the consultant.
    await processTransition(tx, {
      tenantId: signature.tenantId,
      entity: "participant",
      entityId: participant.id,
      status: "contact_updated",
      actorKind: "participant",
      context: {
        participantId: participant.id,
        employerId: participant.employerId ?? undefined,
        consultantId: participant.assignedConsultantId ?? undefined,
      },
    });
    return true;
  });

  redirect(ok ? `/t/${input.token}?done=1` : `/t/${input.token}`);
}

// ---------------------------------------------------------------------------
// Reschedule after no-show
// ---------------------------------------------------------------------------

const rescheduleSchema = z.object({
  token: z.string().min(10),
  scheduledAt: z.string().min(1),
});

export async function rescheduleAppointment(
  formData: FormData,
): Promise<void> {
  if (await isExternalActionThrottled()) {
    redirect(`/t/${String(formData.get("token") ?? "")}?throttled=1`);
  }
  const parsed = rescheduleSchema.safeParse({
    token: formData.get("token"),
    scheduledAt: formData.get("scheduledAt"),
  });
  if (!parsed.success) return;
  const scheduledAt = new Date(parsed.data.scheduledAt);
  if (Number.isNaN(scheduledAt.getTime()) || scheduledAt < new Date()) return;

  const signature = await verifyTokenSignature(parsed.data.token);
  if (!signature) redirect(`/t/${parsed.data.token}`);

  const ok = await withTenant(signature.tenantId, async (tx) => {
    const ctx = await requireCtx(tx, parsed.data.token, [
      "reschedule_after_no_show",
    ]);
    if (!ctx) return false;

    const [participant] = await tx
      .select()
      .from(participants)
      .where(eq(participants.id, ctx.tokenRow.subjectId));
    if (!participant) return false;

    // Carry over the consultant from the missed appointment when possible.
    let consultantId = participant.assignedConsultantId;
    if (ctx.task.subjectKind === "appointment" && ctx.task.subjectId) {
      const [previous] = await tx
        .select({ consultantId: appointments.consultantId })
        .from(appointments)
        .where(eq(appointments.id, ctx.task.subjectId));
      consultantId = previous?.consultantId ?? consultantId;
    }

    // Burn first (atomic gate) so a lost double-submit race never inserts a
    // duplicate appointment.
    if (!(await completeTaskViaToken(tx, ctx))) return false;

    const [appointment] = await tx
      .insert(appointments)
      .values({
        tenantId: signature.tenantId,
        participantId: participant.id,
        consultantId,
        type: "follow_up",
        scheduledAt,
        notes: "Vom Teilnehmer selbst neu vereinbart (nach No-Show)",
      })
      .returning({ id: appointments.id });

    // Same transition as internal scheduling → reminder chain attaches.
    await processTransition(tx, {
      tenantId: signature.tenantId,
      entity: "appointment",
      entityId: appointment.id,
      status: "scheduled",
      actorKind: "participant",
      context: {
        participantId: participant.id,
        employerId: participant.employerId ?? undefined,
        consultantId: consultantId ?? undefined,
        referenceAt: scheduledAt,
        variables: {
          time: scheduledAt.toLocaleString("de-DE", {
            timeZone: "Europe/Berlin",
            dateStyle: "medium",
            timeStyle: "short",
          }),
        },
      },
    });
    return true;
  });

  redirect(ok ? `/t/${parsed.data.token}?done=1` : `/t/${parsed.data.token}`);
}

// ---------------------------------------------------------------------------
// Consent capture (DSGVO)
// ---------------------------------------------------------------------------

// Version stamp of the consent texts shown on the page. Bump when the
// legal copy changes — the audit trail records which version was accepted.
const CONSENT_TEXT_VERSION = "v0.1-placeholder";

export async function giveConsent(formData: FormData): Promise<void> {
  if (await isExternalActionThrottled()) {
    redirect(`/t/${String(formData.get("token") ?? "")}?throttled=1`);
  }
  const token = z.string().min(10).parse(formData.get("token"));
  const privacy = formData.get("privacy") === "on";
  const contact = formData.get("contact") === "on";
  const whatsapp = formData.get("whatsapp") === "on";
  if (!privacy || !contact) return; // required checkboxes

  const signature = await verifyTokenSignature(token);
  if (!signature) redirect(`/t/${token}`);

  const headerStore = await headers();
  // Audit trail: null unless the IP is honestly knowable (see lib/client-ip).
  const ipAddress = requestClientIp(headerStore);

  const ok = await withTenant(signature.tenantId, async (tx) => {
    const ctx = await requireCtx(tx, token, ["give_consent"]);
    if (!ctx) return false;

    // Burn first (atomic gate) so a double-submit can't duplicate consent rows.
    if (!(await completeTaskViaToken(tx, ctx))) return false;

    const base = {
      tenantId: signature.tenantId,
      participantId: ctx.tokenRow.subjectId,
      textVersion: CONSENT_TEXT_VERSION,
      ipAddress,
    };
    await tx.insert(consentRecords).values([
      { ...base, kind: "privacy_policy" as const, granted: true },
      { ...base, kind: "contact_consent" as const, granted: true },
      { ...base, kind: "whatsapp_optin" as const, granted: whatsapp },
    ]);

    return true;
  });

  redirect(ok ? `/t/${token}?done=1` : `/t/${token}`);
}

// ---------------------------------------------------------------------------
// Document upload
// ---------------------------------------------------------------------------

const UPLOAD_DIR = path.join(process.cwd(), "var", "uploads");
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
]);

export async function uploadDocuments(formData: FormData): Promise<void> {
  if (await isExternalActionThrottled()) {
    redirect(`/t/${String(formData.get("token") ?? "")}?throttled=1`);
  }
  const token = z.string().min(10).parse(formData.get("token"));
  const files = formData
    .getAll("files")
    .filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return;

  const signature = await verifyTokenSignature(token);
  if (!signature) redirect(`/t/${token}`);

  // Validate BEFORE opening the transaction / burning the task: the claimed
  // MIME type is client-controlled, so a file is accepted only when its magic
  // bytes match the claim (see lib/file-sniff). Reading the bytes here also
  // keeps the transaction short. The stored extension comes from the sniffed
  // type, never from the client.
  const accepted: { name: string; bytes: Buffer; type: SniffedUploadType }[] =
    [];
  for (const file of files.slice(0, 5)) {
    if (file.size > MAX_UPLOAD_BYTES) continue;
    if (!ALLOWED_TYPES.has(file.type)) continue;
    const bytes = Buffer.from(await file.arrayBuffer());
    const sniffed = sniffUploadType(bytes);
    if (!sniffed || sniffed !== file.type) continue;
    accepted.push({ name: file.name, bytes, type: sniffed });
  }
  // Nothing usable → back with an error while the task is still OPEN, so the
  // participant can retry with real files (burn-first would strand them).
  if (accepted.length === 0) redirect(`/t/${token}?error=1`);

  const ok = await withTenant(signature.tenantId, async (tx) => {
    const ctx = await requireCtx(tx, token, ["upload_documents"]);
    if (!ctx) return false;

    // Burn first (atomic gate): a lost double-submit race writes no files and
    // inserts no duplicate document rows.
    if (!(await completeTaskViaToken(tx, ctx))) return false;

    await mkdir(UPLOAD_DIR, { recursive: true });

    for (const file of accepted) {
      const sha256 = createHash("sha256").update(file.bytes).digest("hex");
      // Stored under a random name — user-supplied filenames never touch disk.
      const fileName = `${crypto.randomUUID()}.${extensionFor(file.type)}`;
      await writeFile(path.join(UPLOAD_DIR, fileName), file.bytes);

      await tx.insert(documents).values({
        tenantId: signature.tenantId,
        type: "participant_upload",
        title: file.name.slice(0, 200),
        status: "submitted",
        participantId: ctx.tokenRow.subjectId,
        filePath: path.join("var", "uploads", fileName),
        sha256,
      });
    }

    await logActivity(tx, {
      tenantId: signature.tenantId,
      actorKind: "participant",
      subjectKind: "participant",
      subjectId: ctx.tokenRow.subjectId,
      event: "documents_uploaded",
      meta: { count: accepted.length },
    });

    return true;
  });

  redirect(ok ? `/t/${token}?done=1` : `/t/${token}`);
}
