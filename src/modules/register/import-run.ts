import { eq } from "drizzle-orm";
import type { DbHandle } from "@/db/client";
import { importRuns } from "@/db/schema";

// How a re-import treated the lead. `inserted` = brand-new lead; `updated` =
// an existing lead had empty register-derived fields filled in; `skipped` =
// the lead already existed and nothing needed refreshing; `conflicted` = a
// lead for this register_id exists but is linked to a different employer, so
// we leave it untouched for manual review.
export type ImportOutcome = "inserted" | "updated" | "skipped" | "conflicted";

// The outcome counters persisted on import_runs.stats. Exactly one counter is
// incremented per single-company import, mirroring the real DB result — the
// import is NEVER optimistically recorded as "everything = inserted".
export type ImportRunStats = {
  inserted: number;
  updated: number;
  skipped: number;
  conflicted: number;
};

// The search/company parameters that produced a run, stored on
// import_runs.criteria for provenance.
export type ImportRunCriteria = {
  companyId: string;
  profitEur: number | null;
  fiscalYear: string | null;
  employees: number | null;
};

/** A zeroed stats object — the honest baseline before any outcome is tallied. */
export function emptyStats(): ImportRunStats {
  return { inserted: 0, updated: 0, skipped: 0, conflicted: 0 };
}

/**
 * Increments exactly the counter matching the real import outcome (pure).
 * Kept side-effect-free and DB-free so the honesty guarantee — one true
 * outcome per company, never a blanket "inserted" — is unit-testable.
 */
export function tallyOutcome(
  outcome: ImportOutcome,
  base: ImportRunStats = emptyStats(),
): ImportRunStats {
  return { ...base, [outcome]: base[outcome] + 1 };
}

type StartImportRunArgs = {
  tenantId: string;
  source: string;
  criteria: ImportRunCriteria;
  startedByUserId: string;
};

/** Opens a `running` import-run row and returns its id (tenant-scoped/RLS). */
export async function startImportRun(
  tx: DbHandle,
  args: StartImportRunArgs,
): Promise<string> {
  const [run] = await tx
    .insert(importRuns)
    .values({
      tenantId: args.tenantId,
      source: args.source,
      status: "running",
      criteria: args.criteria,
      startedByUserId: args.startedByUserId,
    })
    .returning({ id: importRuns.id });
  return run.id;
}

/** Marks a run `completed` with the REAL outcome counters. */
export async function completeImportRun(
  tx: DbHandle,
  runId: string,
  stats: ImportRunStats,
): Promise<void> {
  await tx
    .update(importRuns)
    .set({ status: "completed", finishedAt: new Date(), stats })
    .where(eq(importRuns.id, runId));
}

type RecordFailedRunArgs = StartImportRunArgs & { error: string };

/**
 * Records a standalone `failed` run. Used when the import throws (or the
 * company is not found) — the work transaction has rolled back, so a fresh row
 * is written here rather than flipping a `running` row. Honesty guarantee: a
 * failed import is stored as `failed`, never `completed`.
 */
export async function recordFailedRun(
  tx: DbHandle,
  args: RecordFailedRunArgs,
): Promise<void> {
  const now = new Date();
  await tx.insert(importRuns).values({
    tenantId: args.tenantId,
    source: args.source,
    status: "failed",
    criteria: args.criteria,
    startedByUserId: args.startedByUserId,
    startedAt: now,
    finishedAt: now,
    error: args.error,
  });
}
