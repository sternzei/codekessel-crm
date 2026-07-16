import { eq } from "drizzle-orm";
import type { DbHandle } from "@/db/client";
import { employers } from "@/db/schema";
import { processTransition } from "@/modules/routing/engine";

export type EmployerRow = typeof employers.$inferSelect;
export type EmployerStatus = (typeof employers.status.enumValues)[number];

/**
 * The employer pipeline is derived, not hand-set: the next bottleneck in
 * Betriebsnummer → AG-S → time model determines the status. "confirmed"
 * means the employer side of the application is complete.
 */
export function deriveEmployerStatus(e: EmployerRow): EmployerStatus {
  if (!e.betriebsnummer) return "betriebsnummer_missing";
  if (e.agsRegistered == null || (e.agsRegistered && !e.agsContactName))
    return "ags_unclear";
  if (e.timeModelStatus !== "yes") return "time_model_pending";
  if (!e.contactName || !e.contactEmail) return "setup_in_progress";
  return "confirmed";
}

/**
 * Recomputes the employer status after data changes and pushes the
 * transition through the rules engine (e.g. entering
 * "betriebsnummer_missing" routes a tokenized task to the employer).
 */
export async function recomputeEmployerStatus(
  tx: DbHandle,
  employerId: string,
  actor: {
    kind: "internal_user" | "employer" | "system";
    userId?: string;
  },
): Promise<EmployerStatus> {
  const [employer] = await tx
    .select()
    .from(employers)
    .where(eq(employers.id, employerId));
  if (!employer) throw new Error("Employer not found");

  const next = deriveEmployerStatus(employer);
  if (next === employer.status) return next;

  await tx
    .update(employers)
    .set({ status: next })
    .where(eq(employers.id, employerId));

  await processTransition(tx, {
    tenantId: employer.tenantId,
    entity: "employer",
    entityId: employerId,
    status: next,
    actorKind: actor.kind,
    actorUserId: actor.userId,
    context: { employerId },
  });

  return next;
}
