"use server";

import { createHash } from "node:crypto";
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
import {
  openUploadTicket,
  sealUploadTicket,
  type UploadTicketGrant,
  type UploadTicketResult,
} from "@/modules/participants/upload-ticket";
import { processTransition } from "@/modules/routing/engine";
import { buildStorageKey, getStorage } from "@/modules/storage";
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

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_UPLOAD_FILES = 5;
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
]);
// Long enough for a slow phone connection to finish a 10 MB scan, short
// enough that a leaked URL is worthless by the time anyone finds it.
const UPLOAD_URL_TTL_SECONDS = 15 * 60;

/**
 * A file that passed validation. `key` is set when the bytes are already in
 * storage because the browser put them there directly; otherwise they still
 * have to be written.
 */
type AcceptedUpload = {
  readonly name: string;
  readonly bytes: Buffer;
  readonly type: SniffedUploadType;
  readonly key: string | null;
};

const isAllowedUploadType = (
  value: string,
): value is "application/pdf" | "image/jpeg" | "image/png" =>
  ALLOWED_TYPES.has(value);

/**
 * Accepts a file only when its leading bytes match the type it claims to be
 * (see lib/file-sniff). The claim is client-controlled in both upload paths —
 * as a form field in one, as a signed ticket in the other — so the bytes are
 * the only thing worth believing.
 */
const acceptIfGenuine = (
  input: { readonly name: string; readonly bytes: Buffer; readonly declared: string },
): AcceptedUpload | null => {
  if (input.bytes.byteLength === 0) return null;
  if (input.bytes.byteLength > MAX_UPLOAD_BYTES) return null;
  const sniffed = sniffUploadType(input.bytes);
  if (!sniffed || sniffed !== input.declared) return null;
  return { name: input.name, bytes: input.bytes, type: sniffed, key: null };
};

const ticketSchema = z.object({
  token: z.string().min(10),
  files: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(200),
        contentType: z.string().min(1).max(100),
        byteSize: z.number().int().positive().max(MAX_UPLOAD_BYTES),
      }),
    )
    .min(1)
    .max(MAX_UPLOAD_FILES),
});

/**
 * Issues one presigned upload per file so the bytes never pass through this
 * app — a serverless host caps request bodies well below a scanned document.
 *
 * Deliberately does not complete the task: nothing has been received yet, and
 * burning here would strand a participant whose upload then failed. What it
 * does spend is the same throttle budget as a real submission, so handing out
 * tickets cannot be turned into free storage.
 */
export async function requestUploadTickets(input: {
  token: string;
  files: { name: string; contentType: string; byteSize: number }[];
}): Promise<UploadTicketResult> {
  if (await isExternalActionThrottled()) return { ok: false, reason: "throttled" };

  const parsed = ticketSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "rejected" };

  const storage = getStorage();
  const presign = storage.presignUpload;
  if (!presign) return { ok: false, reason: "unsupported" };

  const signature = await verifyTokenSignature(parsed.data.token);
  if (!signature) return { ok: false, reason: "invalid" };

  // Read-only check that this link may still upload, before anything is
  // signed. The task stays open.
  const permitted = await withTenant(signature.tenantId, async (tx) =>
    Boolean(await requireCtx(tx, parsed.data.token, ["upload_documents"])),
  );
  if (!permitted) return { ok: false, reason: "invalid" };

  const grants: UploadTicketGrant[] = [];
  for (const file of parsed.data.files) {
    if (!isAllowedUploadType(file.contentType)) continue;
    const presigned = await presign({
      // The server picks the key. A client that could name it would be able to
      // aim an upload at an existing object.
      key: buildStorageKey({
        prefix: "uploads",
        extension: extensionFor(file.contentType),
      }),
      contentType: file.contentType,
      byteSize: file.byteSize,
      expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
    });
    grants.push({
      url: presigned.url,
      headers: presigned.headers,
      ticket: await sealUploadTicket(
        {
          key: presigned.key,
          contentType: file.contentType,
          byteSize: file.byteSize,
          fileName: file.name,
        },
        { token: parsed.data.token },
      ),
    });
  }

  if (grants.length === 0) return { ok: false, reason: "rejected" };
  return { ok: true, grants };
}

/**
 * Reads back what the browser uploaded directly and keeps only the genuine
 * files. Objects that fail are removed: a rejected upload must not be left
 * sitting in the bucket, unreferenced and unaccounted for.
 */
async function collectDirectUploads(
  tickets: readonly string[],
  token: string,
): Promise<AcceptedUpload[]> {
  const storage = getStorage();
  const accepted: AcceptedUpload[] = [];
  for (const sealed of tickets.slice(0, MAX_UPLOAD_FILES)) {
    const claims = await openUploadTicket(sealed, { token });
    if (!claims) continue;
    let bytes: Buffer;
    try {
      bytes = await storage.get(claims.key);
    } catch {
      // Never uploaded, or already gone. Nothing to file and nothing to clean.
      continue;
    }
    const file = acceptIfGenuine({
      name: claims.fileName,
      bytes,
      declared: claims.contentType,
    });
    if (!file) {
      await discardObject(claims.key);
      continue;
    }
    accepted.push({ ...file, key: claims.key });
  }
  return accepted;
}

/** Best-effort cleanup; a leftover object must never fail the request. */
async function discardObject(key: string): Promise<void> {
  try {
    await getStorage().delete(key);
  } catch {
    // Swallowed on purpose: the participant's upload is what matters here.
  }
}

async function collectFormUploads(formData: FormData): Promise<AcceptedUpload[]> {
  const files = formData
    .getAll("files")
    .filter((f): f is File => f instanceof File && f.size > 0);
  const accepted: AcceptedUpload[] = [];
  for (const file of files.slice(0, MAX_UPLOAD_FILES)) {
    if (file.size > MAX_UPLOAD_BYTES) continue;
    if (!isAllowedUploadType(file.type)) continue;
    const genuine = acceptIfGenuine({
      name: file.name,
      bytes: Buffer.from(await file.arrayBuffer()),
      declared: file.type,
    });
    if (genuine) accepted.push(genuine);
  }
  return accepted;
}

export async function uploadDocuments(formData: FormData): Promise<void> {
  if (await isExternalActionThrottled()) {
    redirect(`/t/${String(formData.get("token") ?? "")}?throttled=1`);
  }
  const token = z.string().min(10).parse(formData.get("token"));
  const tickets = formData.getAll("tickets").filter((t): t is string =>
    typeof t === "string" && t.length > 0,
  );

  const signature = await verifyTokenSignature(token);
  if (!signature) redirect(`/t/${token}`);

  // Validate BEFORE opening the transaction / burning the task. Reading the
  // bytes here also keeps the transaction short. The stored extension comes
  // from the sniffed type, never from the client.
  const accepted =
    tickets.length > 0
      ? await collectDirectUploads(tickets, token)
      : await collectFormUploads(formData);
  if (accepted.length === 0) {
    // Back with an error while the task is still OPEN, so the participant can
    // retry with real files (burn-first would strand them).
    redirect(`/t/${token}?error=1`);
  }

  const ok = await withTenant(signature.tenantId, async (tx) => {
    const ctx = await requireCtx(tx, token, ["upload_documents"]);
    if (!ctx) return false;

    // Burn first (atomic gate): a lost double-submit race writes no files and
    // inserts no duplicate document rows.
    if (!(await completeTaskViaToken(tx, ctx))) return false;

    const storage = getStorage();
    for (const file of accepted) {
      const sha256 = createHash("sha256").update(file.bytes).digest("hex");
      // Stored under a random key — user-supplied filenames never reach storage.
      const key =
        file.key ??
        (await storage.put({
          key: buildStorageKey({
            prefix: "uploads",
            extension: extensionFor(file.type),
          }),
          bytes: file.bytes,
          contentType: file.type,
        }));

      await tx.insert(documents).values({
        tenantId: signature.tenantId,
        type: "participant_upload",
        title: file.name.slice(0, 200),
        status: "submitted",
        participantId: ctx.tokenRow.subjectId,
        filePath: key,
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

  if (!ok) {
    // The link was spent or revoked between validation and the burn. Nothing
    // was filed, so the bytes already in the bucket reference nothing.
    for (const file of accepted) {
      if (file.key) await discardObject(file.key);
    }
  }
  redirect(ok ? `/t/${token}?done=1` : `/t/${token}`);
}
