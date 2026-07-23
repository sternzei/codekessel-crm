"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { employers } from "@/db/schema";
import { logActivity } from "@/modules/audit/log";
import {
  completeTaskViaToken,
  loadTokenContext,
  verifyTokenSignature,
} from "@/modules/tokens/service";
import { isExternalActionThrottled } from "@/modules/tokens/request-throttle";
import {
  isValidBic,
  isValidIban,
  normalizeBic,
  normalizeIban,
  parseSalaryComponents,
  parseStaffingBands,
} from "@/lib/ba-format";
import { deriveEmployerStatus, recomputeEmployerStatus } from "./service";

const EMPLOYER_SCOPES = new Set([
  "provide_betriebsnummer",
  "confirm_ags_status",
  "confirm_time_model",
  "employer_setup",
]);

const setupSchema = z.object({
  token: z.string().min(10),
  betriebsnummer: z.string().trim().max(20).optional(),
  agsRegistered: z.enum(["yes", "no", "unsure"]).optional(),
  agsContactName: z.string().trim().max(200).optional(),
  agsContactEmail: z.string().trim().email().optional().or(z.literal("")),
  agsContactPhone: z.string().trim().max(50).optional(),
  contactName: z.string().trim().max(200).optional(),
  contactRole: z.string().trim().max(100).optional(),
  contactEmail: z.string().trim().email().optional().or(z.literal("")),
  contactPhone: z.string().trim().max(50).optional(),
  timeModel: z
    .enum(["yes", "partial", "not_possible", "unclear"])
    .optional(),
  // Epic A additions (BA application data).
  legalForm: z.string().trim().max(100).optional(),
  iban: z.string().trim().max(40).optional(),
  bic: z.string().trim().max(20).optional(),
  betriebsvereinbarung: z.enum(["yes", "no"]).optional(),
});

/**
 * External task: the employer setup assistant (Betriebsnummer → AG-S →
 * contact person → time model) submits everything it has. Partial data is
 * saved and the link STAYS valid — the wizard re-opens at the remaining
 * steps. The token is only burned once the employer side is complete.
 * This re-entry behavior is deliberate drop-off reduction.
 */
export async function submitEmployerSetup(formData: FormData): Promise<void> {
  if (await isExternalActionThrottled()) {
    redirect(`/t/${String(formData.get("token") ?? "")}?throttled=1`);
  }
  const parsed = setupSchema.safeParse({
    token: formData.get("token"),
    betriebsnummer: formData.get("betriebsnummer") ?? undefined,
    agsRegistered: formData.get("agsRegistered") ?? undefined,
    agsContactName: formData.get("agsContactName") ?? undefined,
    agsContactEmail: formData.get("agsContactEmail") ?? "",
    agsContactPhone: formData.get("agsContactPhone") ?? undefined,
    contactName: formData.get("contactName") ?? undefined,
    contactRole: formData.get("contactRole") ?? undefined,
    contactEmail: formData.get("contactEmail") ?? "",
    contactPhone: formData.get("contactPhone") ?? undefined,
    timeModel: formData.get("timeModel") ?? undefined,
    legalForm: formData.get("legalForm") ?? undefined,
    iban: formData.get("iban") ?? undefined,
    bic: formData.get("bic") ?? undefined,
    betriebsvereinbarung: formData.get("betriebsvereinbarung") || undefined,
  });
  if (!parsed.success) return;
  const input = parsed.data;
  const read = (key: string): string | undefined =>
    formData.get(key)?.toString();
  // Conservative: only store a well-formed IBAN/BIC; a malformed value is
  // ignored (the wizard re-renders so the employer can retry) rather than
  // rejecting the whole partial save or persisting garbage.
  const iban = input.iban && isValidIban(input.iban) ? input.iban : undefined;
  const bic = input.bic && isValidBic(input.bic) ? input.bic : undefined;
  const staffing = parseStaffingBands(read);
  const salaryComponents = parseSalaryComponents(read);

  const signature = await verifyTokenSignature(input.token);
  if (!signature) redirect(`/t/${input.token}`);

  await withTenant(signature.tenantId, async (tx) => {
    const ctx = await loadTokenContext(tx, input.token);
    if (!ctx.ok || !EMPLOYER_SCOPES.has(ctx.tokenRow.scope)) return;
    if (ctx.tokenRow.subjectKind !== "employer") return;

    const employerId = ctx.tokenRow.subjectId;
    const [employer] = await tx
      .select()
      .from(employers)
      .where(eq(employers.id, employerId));
    if (!employer) return;

    await tx
      .update(employers)
      .set({
        betriebsnummer: input.betriebsnummer || employer.betriebsnummer,
        agsRegistered:
          input.agsRegistered === "yes"
            ? true
            : input.agsRegistered === "no"
              ? false
              : employer.agsRegistered,
        agsContactName: input.agsContactName || employer.agsContactName,
        agsContactEmail: input.agsContactEmail || employer.agsContactEmail,
        agsContactPhone: input.agsContactPhone || employer.agsContactPhone,
        contactName: input.contactName || employer.contactName,
        contactRole: input.contactRole || employer.contactRole,
        contactEmail: input.contactEmail || employer.contactEmail,
        contactPhone: input.contactPhone || employer.contactPhone,
        timeModelStatus: input.timeModel
          ? input.timeModel === "yes"
            ? "yes"
            : input.timeModel === "partial"
              ? "partial"
              : input.timeModel === "not_possible"
                ? "not_possible"
                : "unclear"
          : employer.timeModelStatus,
        trainingSupportConfirmed:
          input.timeModel === "yes" ? true : employer.trainingSupportConfirmed,
        legalForm: input.legalForm || employer.legalForm,
        iban: iban ? normalizeIban(iban) : employer.iban,
        bic: bic ? normalizeBic(bic) : employer.bic,
        hasBetriebsvereinbarung:
          input.betriebsvereinbarung === "yes"
            ? true
            : input.betriebsvereinbarung === "no"
              ? false
              : employer.hasBetriebsvereinbarung,
        staffingByHoursBand: staffing ?? employer.staffingByHoursBand,
        salaryComponents: salaryComponents ?? employer.salaryComponents,
      })
      .where(eq(employers.id, employerId));

    await logActivity(tx, {
      tenantId: signature.tenantId,
      actorKind: "employer",
      subjectKind: "employer",
      subjectId: employerId,
      event: "setup_data_submitted",
    });

    const status = await recomputeEmployerStatus(tx, employerId, {
      kind: "employer",
    });

    // Complete → burn the token and close the task via the shared path, so the
    // employer wizard emits the same `task_completed` audit event (and gets the
    // sibling-token revoke + reminder cancellation) as every other magic link.
    if (status === "confirmed") {
      await completeTaskViaToken(tx, ctx);
    }
  });

  // Re-render the wizard: either remaining steps or the thank-you state.
  const [row] = await withTenant(signature.tenantId, async (tx) => {
    const ctx = await loadTokenContext(tx, input.token);
    if (!ctx.ok) return [true];
    const [e] = await tx
      .select()
      .from(employers)
      .where(eq(employers.id, ctx.tokenRow.subjectId));
    return [e ? deriveEmployerStatus(e) === "confirmed" : false];
  });
  redirect(row ? `/t/${input.token}?done=1` : `/t/${input.token}?saved=1`);
}
