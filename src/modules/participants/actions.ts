"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { tasks } from "@/db/schema";
import { logActivity } from "@/modules/audit/log";
import { recordAvailability } from "@/modules/participants/transitions";
import {
  loadTokenContext,
  markTokenUsed,
  verifyTokenSignature,
} from "@/modules/tokens/service";

const inputSchema = z.object({
  token: z.string().min(10),
  availability: z.enum([
    "yes",
    "probably_employer_pending",
    "partial",
    "not_possible",
    "unclear",
  ]),
});

/**
 * External task: participant confirms the 20h/week × 6 months availability
 * via their magic link. Completes the task, burns the token, and feeds the
 * result back into the routing engine — anything but a clear "yes" spawns
 * follow-up tasks per the seeded rules.
 */
export async function confirmAvailability(formData: FormData): Promise<void> {
  const parsed = inputSchema.safeParse({
    token: formData.get("token"),
    availability: formData.get("availability"),
  });
  if (!parsed.success) return;

  const { token, availability } = parsed.data;
  const signature = await verifyTokenSignature(token);
  if (!signature) redirect(`/t/${token}`);

  const ok = await withTenant(signature.tenantId, async (tx) => {
    const ctx = await loadTokenContext(tx, token);
    if (!ctx.ok || ctx.tokenRow.scope !== "confirm_availability") return false;

    // Burn first (atomic single-use gate): a lost race performs no side effects.
    const burned = await markTokenUsed(tx, ctx.tokenRow);
    if (!burned) return false;

    await tx
      .update(tasks)
      .set({ status: "done", completedAt: new Date() })
      .where(eq(tasks.id, ctx.task.id));

    await logActivity(tx, {
      tenantId: ctx.tokenRow.tenantId,
      actorKind: "participant",
      subjectKind: "task",
      subjectId: ctx.task.id,
      event: "task_completed",
      meta: { taskType: ctx.task.type },
    });

    // Feed the answer back into the rules engine ("availability_<answer>").
    await recordAvailability(tx, {
      participantId: ctx.tokenRow.subjectId,
      availability,
      actorKind: "participant",
    });
    return true;
  });

  // F5: only show the success state when the mutation actually happened.
  redirect(ok ? `/t/${token}?done=1` : `/t/${token}`);
}
