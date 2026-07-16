"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { employers, tasks } from "@/db/schema";
import { logActivity } from "@/modules/audit/log";
import {
  loadTokenContext,
  markTokenUsed,
  verifyTokenSignature,
} from "@/modules/tokens/service";
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
});

/**
 * External task: the employer setup assistant (Betriebsnummer → AG-S →
 * contact person → time model) submits everything it has. Partial data is
 * saved and the link STAYS valid — the wizard re-opens at the remaining
 * steps. The token is only burned once the employer side is complete.
 * This re-entry behavior is deliberate drop-off reduction.
 */
export async function submitEmployerSetup(formData: FormData): Promise<void> {
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
  });
  if (!parsed.success) return;
  const input = parsed.data;

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

    // Complete → close the task and burn the token (single use fulfilled).
    if (status === "confirmed") {
      await tx
        .update(tasks)
        .set({ status: "done", completedAt: new Date() })
        .where(eq(tasks.id, ctx.task.id));
      await markTokenUsed(tx, ctx.tokenRow);
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
