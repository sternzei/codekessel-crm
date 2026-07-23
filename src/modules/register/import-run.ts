import { eq } from "drizzle-orm";
import type { DbHandle } from "@/db/client";
import { importRuns } from "@/db/schema";
import type { FinancialsSource } from "./types";

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
  // Provenance of the loss figure carried from discovery — persisted on the
  // lead alongside the structured columns (see buildFinancialColumns).
  financialsSource: FinancialsSource | null;
};

// The structured financial columns persisted on the imported lead
// (participants.net_income / financial_year / financials_source). numeric is
// passed to Drizzle as a string, so net_income stays exact and sign-safe.
export type FinancialColumns = {
  netIncome: string | null;
  financialYear: number | null;
  financialsSource: FinancialsSource | null;
};

/**
 * Parses the 4-digit reporting year out of the discovery `fiscalYear` string
 * (e.g. "2024" or "2024-12-31") into an integer, or null when absent/invalid.
 */
export function parseFinancialYear(fiscalYear: string | null): number | null {
  if (!fiscalYear) return null;
  const year = Number.parseInt(fiscalYear.slice(0, 4), 10);
  return Number.isInteger(year) ? year : null;
}

/**
 * Maps the discovery financial signal onto the persisted columns (pure). A
 * missing net income stays null — NEVER coerced to 0 — mirroring
 * extractSearchFinancials; the sign is preserved by stringifying as-is.
 */
export function buildFinancialColumns(criteria: {
  profitEur: number | null;
  fiscalYear: string | null;
  financialsSource: FinancialsSource | null;
}): FinancialColumns {
  return {
    netIncome: criteria.profitEur != null ? String(criteria.profitEur) : null,
    financialYear: parseFinancialYear(criteria.fiscalYear),
    financialsSource: criteria.financialsSource,
  };
}

// Criteria for a multi-company batch run: the discovery filters that produced
// the page plus the number of companies discovered/attempted.
export type BatchImportRunCriteria = {
  employeesMin: number;
  employeesMax: number;
  federalState: string;
  legalForms: string[];
  page: number;
  discovered: number;
};

// Any criteria shape persisted on import_runs.criteria (jsonb).
export type RunCriteria = ImportRunCriteria | BatchImportRunCriteria;

// Batch stats: the per-company outcome tally plus the number of companies
// discovered and the count that failed to import. discovered ===
// inserted + updated + skipped + conflicted + failed for a fully-attempted batch.
export type BatchImportStats = {
  discovered: number;
  inserted: number;
  updated: number;
  skipped: number;
  conflicted: number;
  failed: number;
};

// One company's real batch outcome: a normal import outcome, or a failure.
export type BatchItemResult = ImportOutcome | "failed";

/** A zeroed batch-stats object. */
export function emptyBatchStats(): BatchImportStats {
  return { discovered: 0, inserted: 0, updated: 0, skipped: 0, conflicted: 0, failed: 0 };
}

/**
 * Tallies a batch of per-company results into ONE honest stats object (pure).
 * `discovered` is the number of companies attempted, and every result bumps
 * exactly its own counter — never a blanket "everything = inserted".
 */
export function tallyBatch(
  results: readonly BatchItemResult[],
): BatchImportStats {
  const stats = emptyBatchStats();
  stats.discovered = results.length;
  for (const result of results) stats[result] += 1;
  return stats;
}

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
  criteria: RunCriteria;
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
  stats: ImportRunStats | BatchImportStats,
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
