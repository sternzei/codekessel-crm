"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { withTenant } from "@/db/client";
import {
  completeTaskViaToken,
  loadTokenContext,
  verifyTokenSignature,
} from "@/modules/tokens/service";
import { changeApplicationStatus } from "./service";

/**
 * External task: the employer confirms the application was submitted to
 * the Arbeitgeberservice. Flips the application to "submitted" and stamps
 * the submission date.
 */
export async function confirmSubmission(formData: FormData): Promise<void> {
  const token = z.string().min(10).parse(formData.get("token"));
  const confirmed = formData.get("confirmed") === "on";
  if (!confirmed) return;

  const signature = await verifyTokenSignature(token);
  if (!signature) redirect(`/t/${token}`);

  let ok = false;
  try {
    ok = await withTenant(signature.tenantId, async (tx) => {
      const ctx = await loadTokenContext(tx, token);
      if (!ctx.ok || ctx.tokenRow.scope !== "confirm_submission") return false;
      if (ctx.task.subjectKind !== "application" || !ctx.task.subjectId) {
        return false;
      }

      await changeApplicationStatus(tx, {
        applicationId: ctx.task.subjectId,
        to: "submitted",
        actorKind: "employer",
      });

      return completeTaskViaToken(tx, ctx);
    });
  } catch {
    // The submission gate (readiness/transition) or a transient failure must
    // not surface as a raw 500 to the external employer — send them back to a
    // friendly retry screen instead.
    redirect(`/t/${token}?error=1`);
  }

  redirect(ok ? `/t/${token}?done=1` : `/t/${token}`);
}
