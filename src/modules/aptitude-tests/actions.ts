"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { aptitudeTests } from "@/db/schema";
import { logActivity } from "@/modules/audit/log";
import {
  loadTokenContext,
  verifyTokenSignature,
} from "@/modules/tokens/service";

/**
 * External task: participant clicks "Test starten" on their magic link.
 * Marks the test as started and forwards to the external test URL.
 * The token stays valid (NOT single-use here): the participant may return
 * to the link until the test is completed — re-entry is a feature for
 * no-show reduction, not a security hole (the scope only allows starting).
 */
export async function startAptitudeTest(formData: FormData): Promise<void> {
  const token = z.string().min(10).parse(formData.get("token"));
  const signature = await verifyTokenSignature(token);
  if (!signature) redirect(`/t/${token}`);

  const testUrl = await withTenant(signature.tenantId, async (tx) => {
    const ctx = await loadTokenContext(tx, token);
    if (!ctx.ok || ctx.tokenRow.scope !== "start_aptitude_test") return null;
    if (ctx.task.subjectKind !== "aptitude_test" || !ctx.task.subjectId)
      return null;

    const [test] = await tx
      .select()
      .from(aptitudeTests)
      .where(eq(aptitudeTests.id, ctx.task.subjectId));
    if (!test) return null;

    if (test.status === "invited") {
      await tx
        .update(aptitudeTests)
        .set({ status: "started", startedAt: new Date() })
        .where(eq(aptitudeTests.id, test.id));

      await logActivity(tx, {
        tenantId: signature.tenantId,
        actorKind: "participant",
        subjectKind: "aptitude_test",
        subjectId: test.id,
        event: "status_changed",
        meta: { status: "started" },
      });
    }
    return test.testUrl;
  });

  redirect(testUrl ?? `/t/${token}`);
}
