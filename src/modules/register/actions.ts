"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { withTenant, type Tx } from "@/db/client";
import { employers, participants } from "@/db/schema";
import { logActivity } from "@/modules/audit/log";
import { getAdminSession, getSession } from "@/modules/auth/session";
import {
  getRegisterProvider,
  type FinancialsSource,
  type RegisterCompanyDetail,
} from "@/modules/register";
import {
  buildFinancialColumns,
  completeImportRun,
  recordFailedRun,
  startImportRun,
  tallyBatch,
  tallyOutcome,
  type BatchImportRunCriteria,
  type BatchItemResult,
  type FinancialColumns,
  type ImportOutcome,
  type ImportRunCriteria,
} from "./import-run";

const REGISTER_SOURCE = "openregister";
// import_runs.error is unbounded text; cap the stored message so a huge
// upstream error body never bloats a run row.
const MAX_ERROR_LENGTH = 1000;

// OpenRegister import is admin-only. The role lives in the signed session
// cookie, so this is a real authorization boundary — not just a hidden link.
async function requireAdmin() {
  const admin = await getAdminSession();
  if (admin) return admin;
  const session = await getSession();
  redirect(session ? "/pipeline?forbidden=1" : "/auth/sign-in");
}

const numOrNull = (v: FormDataEntryValue | null): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const strOrNull = (v: FormDataEntryValue | null): string | null => {
  const s = v == null ? "" : String(v).trim();
  return s || null;
};
// Only accept the known provenance tokens; anything else (incl. "") → null so
// a malformed hidden field can never persist a bogus source.
const financialsSourceOrNull = (
  v: FormDataEntryValue | null,
): FinancialsSource | null => {
  const s = strOrNull(v);
  return s === "indicators" || s === "search_row" ? s : null;
};

/** Human-readable "why we're calling" note stamped onto the imported lead. */
function buildLossNote(
  profitEur: number | null,
  fiscalYear: string | null,
  employees: number | null,
): string {
  const parts: string[] = [];
  if (profitEur != null) {
    parts.push(`Jahresergebnis ${Math.round(profitEur).toLocaleString("de-DE")} €`);
  }
  if (fiscalYear) parts.push(`GJ ${fiscalYear}`);
  if (employees != null) parts.push(`${employees} Mitarbeitende`);
  const detail = parts.length ? ` (${parts.join(", ")})` : "";
  return `Aus OpenRegister übernommen — Unternehmen mit finanziellem Verlust${detail}. Zielprofil für AZAV-Förderung.`;
}

/**
 * Imports one distressed company as a linked employer + a single lead. The lead
 * is the company's current managing director (the person to call); the loss
 * figures land in the lead's eligibility notes as the outreach rationale.
 * Deduped on register_id: re-importing never duplicates the employer OR the
 * lead. See {@link ImportOutcome} for how an existing lead is handled.
 *
 * Every invocation records ONE import_runs row (source `openregister`) so the
 * pipeline freshness strip + run history populate. The run is scoped to the
 * single company this action imports (a per-invocation batch of size one — the
 * honest granularity for a per-company action). Status is `completed` with the
 * real {inserted|updated|skipped|conflicted} counter set on success, and a
 * separate `failed` row (with the error text) is written when the register
 * fetch or the DB work throws, or the company is not found — a failed import is
 * NEVER stored as `completed`.
 */
export async function importCompany(formData: FormData): Promise<void> {
  const admin = await requireAdmin();

  const companyId = z.string().min(1).parse(formData.get("companyId"));
  const criteria: ImportRunCriteria = {
    companyId,
    profitEur: numOrNull(formData.get("profitEur")),
    fiscalYear: strOrNull(formData.get("fiscalYear")),
    employees: numOrNull(formData.get("employees")),
    financialsSource: financialsSourceOrNull(formData.get("financialsSource")),
  };

  const result = await runImport(admin, criteria);
  if (result.kind === "notfound") redirect("/leads/import?error=notfound");

  revalidatePath("/pipeline");
  redirect(`/pipeline?import=${result.outcome}`);
}

/**
 * Batch import: imports every company on the current discovery page in ONE
 * import_runs row with the REAL aggregate stats
 * {discovered, inserted, updated, skipped, conflicted, failed}. Each company is
 * applied in its own tenant transaction stamped with the shared run id; a
 * per-company failure is counted as `failed` and does NOT abort the batch, so
 * the run still closes as `completed` with an honest failure count.
 */
export async function importCompanies(formData: FormData): Promise<void> {
  const admin = await requireAdmin();

  const companyIds = formData.getAll("companyId").map(String).filter(Boolean);
  if (companyIds.length === 0) redirect("/leads/import?error=notfound");

  const profits = formData.getAll("profitEur");
  const fiscalYears = formData.getAll("fiscalYear");
  const employeesList = formData.getAll("employees");
  const financialsSources = formData.getAll("financialsSource");
  const items = companyIds.map((companyId, i) => ({
    companyId,
    profitEur: numOrNull(profits[i] ?? null),
    fiscalYear: strOrNull(fiscalYears[i] ?? null),
    employees: numOrNull(employeesList[i] ?? null),
    financialsSource: financialsSourceOrNull(financialsSources[i] ?? null),
  }));

  const batchCriteria: BatchImportRunCriteria = {
    employeesMin: numOrNull(formData.get("employeesMin")) ?? 0,
    employeesMax: numOrNull(formData.get("employeesMax")) ?? 0,
    federalState: strOrNull(formData.get("federalState")) ?? "",
    legalForms: formData.getAll("legalForms").map(String).filter(Boolean),
    page: numOrNull(formData.get("page")) ?? 1,
    discovered: items.length,
  };

  const stats = await runBatchImport(admin, items, batchCriteria);

  revalidatePath("/pipeline");
  redirect(`/pipeline?imported=${stats.inserted + stats.updated}`);
}

type BatchItem = {
  companyId: string;
  profitEur: number | null;
  fiscalYear: string | null;
  employees: number | null;
  financialsSource: FinancialsSource | null;
};

/**
 * Opens one run, applies each company under the shared run id (own tx per
 * company), then closes the run with the aggregated batch stats. Fetch/import
 * errors and not-found companies are tallied as `failed` and never abort the
 * batch.
 */
async function runBatchImport(
  admin: { id: string; tenantId: string },
  items: BatchItem[],
  batchCriteria: BatchImportRunCriteria,
): Promise<ReturnType<typeof tallyBatch>> {
  const runId = await withTenant(admin.tenantId, (tx) =>
    startImportRun(tx, {
      tenantId: admin.tenantId,
      source: REGISTER_SOURCE,
      criteria: batchCriteria,
      startedByUserId: admin.id,
    }),
  );

  const results: BatchItemResult[] = [];
  for (const item of items) {
    const itemCriteria: ImportRunCriteria = {
      companyId: item.companyId,
      profitEur: item.profitEur,
      fiscalYear: item.fiscalYear,
      employees: item.employees,
      financialsSource: item.financialsSource,
    };
    try {
      const company = await getRegisterProvider().getCompany(item.companyId);
      if (!company) {
        results.push("failed");
        continue;
      }
      const outcome = await withTenant(admin.tenantId, (tx) =>
        applyCompanyToRun(tx, admin, company, itemCriteria, runId),
      );
      results.push(outcome);
    } catch {
      // Honest failure accounting: one bad company must not sink the batch.
      results.push("failed");
    }
  }

  const stats = tallyBatch(results);
  await withTenant(admin.tenantId, (tx) => completeImportRun(tx, runId, stats));
  return stats;
}

type ImportResult =
  | { kind: "notfound" }
  | { kind: "done"; outcome: ImportOutcome };

/**
 * Fetches the company, imports it, and records the import_runs row — recording
 * a `failed` run on any thrown error. Deliberately never calls `redirect()`
 * itself: it returns a discriminated result so the caller owns every redirect
 * outside of a try/catch (Next's redirect throws, so catching it here would
 * corrupt the run status).
 */
async function runImport(
  admin: { id: string; tenantId: string },
  criteria: ImportRunCriteria,
): Promise<ImportResult> {
  let company: RegisterCompanyDetail | null;
  try {
    company = await getRegisterProvider().getCompany(criteria.companyId);
  } catch (error) {
    await withTenant(admin.tenantId, (tx) =>
      recordFailedRun(tx, failedRunArgs(admin, criteria, error)),
    );
    throw error;
  }

  if (!company) {
    await withTenant(admin.tenantId, (tx) =>
      recordFailedRun(tx, {
        ...runArgs(admin, criteria),
        error: "company_not_found",
      }),
    );
    return { kind: "notfound" };
  }

  const found = company;
  try {
    const outcome = await withTenant(admin.tenantId, (tx) =>
      importCompanyLead(tx, admin, found, criteria),
    );
    return { kind: "done", outcome };
  } catch (error) {
    await withTenant(admin.tenantId, (tx) =>
      recordFailedRun(tx, failedRunArgs(admin, criteria, error)),
    );
    throw error;
  }
}

function runArgs(
  admin: { id: string; tenantId: string },
  criteria: ImportRunCriteria,
) {
  return {
    tenantId: admin.tenantId,
    source: REGISTER_SOURCE,
    criteria,
    startedByUserId: admin.id,
  };
}

function failedRunArgs(
  admin: { id: string; tenantId: string },
  criteria: ImportRunCriteria,
  error: unknown,
) {
  return { ...runArgs(admin, criteria), error: errorText(error) };
}

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, MAX_ERROR_LENGTH);
}

/**
 * The DB work for a single company: opens the run, applies the company to it,
 * and closes the run as `completed` with the real outcome counter — all inside
 * one tenant transaction so the run row and the lead commit atomically.
 */
async function importCompanyLead(
  tx: Tx,
  admin: { id: string; tenantId: string },
  company: RegisterCompanyDetail,
  criteria: ImportRunCriteria,
): Promise<ImportOutcome> {
  const runId = await startImportRun(tx, runArgs(admin, criteria));
  const outcome = await applyCompanyToRun(tx, admin, company, criteria, runId);
  await completeImportRun(tx, runId, tallyOutcome(outcome));
  return outcome;
}

/**
 * Resolves the employer and inserts/refreshes the one lead for a company,
 * stamping the given `runId` on the created/updated lead. Shared by the
 * single-company import (its own run) and the batch import (one run for the
 * whole page). Does NOT open or close the run — the caller owns that.
 */
async function applyCompanyToRun(
  tx: Tx,
  admin: { id: string; tenantId: string },
  company: RegisterCompanyDetail,
  criteria: ImportRunCriteria,
  runId: string,
): Promise<ImportOutcome> {
  const employerId = await resolveEmployerId(
    tx,
    admin,
    company,
    criteria.employees,
  );

  // Prefer a current managing director; fall back to any current representative.
  const director =
    company.representatives.find((r) => r.isManagingDirector) ??
    company.representatives[0] ??
    null;
  // One lead per company: the director if we have one, else the company.
  const firstName =
    director?.firstName?.trim() || director?.name?.trim() || company.name;
  const lastName =
    director?.lastName?.trim() || (director ? company.name : "(Firma)");
  const city = director?.city ?? company.address.city;
  const lossNote = buildLossNote(
    criteria.profitEur,
    criteria.fiscalYear,
    criteria.employees,
  );
  // Structured financial provenance persisted alongside the free-text note.
  const financialColumns = buildFinancialColumns(criteria);

  const [existingLead] = await tx
    .select({
      id: participants.id,
      employerId: participants.employerId,
      city: participants.city,
      eligibilityNotes: participants.eligibilityNotes,
      netIncome: participants.netIncome,
      financialYear: participants.financialYear,
      financialsSource: participants.financialsSource,
    })
    .from(participants)
    .where(
      and(
        eq(participants.tenantId, admin.tenantId),
        eq(participants.registerId, company.companyId),
      ),
    );

  const outcome = existingLead
    ? await refreshExistingLead(tx, admin, {
        existingLead,
        employerId,
        city,
        lossNote,
        financialColumns,
        registerId: company.companyId,
        importRunId: runId,
      })
    : await insertLead(tx, admin, {
        firstName,
        lastName,
        city,
        lossNote,
        financialColumns,
        registerId: company.companyId,
        employerId,
        importRunId: runId,
        role: director?.role ?? null,
        profitEur: criteria.profitEur,
      });

  return outcome;
}

/**
 * Inserts the brand-new lead. `onConflictDoNothing` keeps it idempotent under a
 * concurrent re-import (the partial unique index on (tenant_id, register_id) is
 * the guard); an empty return means another import won the race → `skipped`.
 */
async function insertLead(
  tx: Tx,
  admin: { id: string; tenantId: string },
  args: {
    firstName: string;
    lastName: string;
    city: string | null;
    lossNote: string;
    financialColumns: FinancialColumns;
    registerId: string;
    employerId: string;
    importRunId: string;
    role: string | null;
    profitEur: number | null;
  },
): Promise<ImportOutcome> {
  const [lead] = await tx
    .insert(participants)
    .values({
      tenantId: admin.tenantId,
      firstName: args.firstName,
      lastName: args.lastName,
      city: args.city,
      source: REGISTER_SOURCE,
      registerId: args.registerId,
      employerId: args.employerId,
      importRunId: args.importRunId,
      eligibilityNotes: args.lossNote,
      // Structured provenance mirrored from the discovery signal (missing
      // figures stay null — never coerced to 0; see buildFinancialColumns).
      netIncome: args.financialColumns.netIncome,
      financialYear: args.financialColumns.financialYear,
      financialsSource: args.financialColumns.financialsSource,
      // Left unassigned on purpose — triaged from the pipeline board.
    })
    .onConflictDoNothing({
      target: [participants.tenantId, participants.registerId],
      where: sql`${participants.registerId} is not null`,
    })
    .returning({ id: participants.id });

  if (!lead) {
    await logActivity(tx, {
      tenantId: admin.tenantId,
      actorKind: "internal_user",
      actorUserId: admin.id,
      subjectKind: "employer",
      subjectId: args.employerId,
      event: "lead_import_skipped",
      meta: { registerId: args.registerId, outcome: "skipped" },
    });
    return "skipped";
  }

  await logActivity(tx, {
    tenantId: admin.tenantId,
    actorKind: "internal_user",
    actorUserId: admin.id,
    subjectKind: "participant",
    subjectId: lead.id,
    event: "lead_imported",
    meta: {
      registerId: args.registerId,
      role: args.role,
      profitEur: args.profitEur,
      outcome: "inserted",
    },
  });
  return "inserted";
}

/** Dedup the employer on register_id, creating it (and logging) if new. */
async function resolveEmployerId(
  tx: Tx,
  admin: { id: string; tenantId: string },
  company: NonNullable<
    Awaited<ReturnType<ReturnType<typeof getRegisterProvider>["getCompany"]>>
  >,
  employees: number | null,
): Promise<string> {
  const [existing] = await tx
    .select({ id: employers.id })
    .from(employers)
    .where(
      and(
        eq(employers.tenantId, admin.tenantId),
        eq(employers.registerId, company.companyId),
      ),
    );
  if (existing) return existing.id;
  const [emp] = await tx
    .insert(employers)
    .values({
      tenantId: admin.tenantId,
      companyName: company.name,
      street: company.address.street,
      postalCode: company.address.postalCode,
      city: company.address.city,
      industry: company.industryCode,
      employeeCount: employees,
      contactEmail: company.contact.email,
      contactPhone: company.contact.phone,
      source: "openregister",
      registerId: company.companyId,
      registerNumber: company.registerNumber,
      registerType: company.registerType,
      registerCourt: company.registerCourt,
    })
    .returning({ id: employers.id });
  await logActivity(tx, {
    tenantId: admin.tenantId,
    actorKind: "internal_user",
    actorUserId: admin.id,
    subjectKind: "employer",
    subjectId: emp.id,
    event: "employer_imported",
    meta: { registerId: company.companyId },
  });
  return emp.id;
}

type ExistingLead = {
  id: string;
  employerId: string | null;
  city: string | null;
  eligibilityNotes: string | null;
  netIncome: string | null;
  financialYear: number | null;
  financialsSource: string | null;
};

/**
 * Conservative re-import refresh: only fills register-derived fields that are
 * still EMPTY. We never overwrite a non-empty field, because a consultant may
 * have corrected the city or appended to the eligibility notes — clobbering
 * their edits on every re-import would lose real work.
 */
async function refreshExistingLead(
  tx: Tx,
  admin: { id: string; tenantId: string },
  args: {
    existingLead: ExistingLead;
    employerId: string;
    city: string | null;
    lossNote: string;
    financialColumns: FinancialColumns;
    registerId: string;
    importRunId: string;
  },
): Promise<ImportOutcome> {
  const {
    existingLead,
    employerId,
    city,
    lossNote,
    financialColumns,
    registerId,
    importRunId,
  } = args;

  if (existingLead.employerId && existingLead.employerId !== employerId) {
    await logActivity(tx, {
      tenantId: admin.tenantId,
      actorKind: "internal_user",
      actorUserId: admin.id,
      subjectKind: "participant",
      subjectId: existingLead.id,
      event: "lead_import_conflict",
      meta: { registerId, outcome: "conflicted" },
    });
    return "conflicted";
  }

  const patch: Partial<typeof participants.$inferInsert> = {};
  if (existingLead.employerId == null) patch.employerId = employerId;
  if (existingLead.city == null && city) patch.city = city;
  if (existingLead.eligibilityNotes == null) patch.eligibilityNotes = lossNote;
  // Conservative gap-fill of the structured provenance: only set a column that
  // is still empty AND for which discovery actually carried a figure, so a
  // re-import never clobbers a corrected value nor overwrites a real figure
  // with null.
  if (existingLead.netIncome == null && financialColumns.netIncome != null) {
    patch.netIncome = financialColumns.netIncome;
  }
  if (
    existingLead.financialYear == null &&
    financialColumns.financialYear != null
  ) {
    patch.financialYear = financialColumns.financialYear;
  }
  if (
    existingLead.financialsSource == null &&
    financialColumns.financialsSource != null
  ) {
    patch.financialsSource = financialColumns.financialsSource;
  }

  // A genuine gap-fill is required for `updated`; the empty-patch check MUST
  // run before stamping import_run_id, otherwise every re-import would look
  // like an update and `skipped` could never be returned.
  if (Object.keys(patch).length === 0) {
    await logActivity(tx, {
      tenantId: admin.tenantId,
      actorKind: "internal_user",
      actorUserId: admin.id,
      subjectKind: "participant",
      subjectId: existingLead.id,
      event: "lead_import_skipped",
      meta: { registerId, outcome: "skipped" },
    });
    return "skipped";
  }

  // Audit the register-derived fields we filled (before the run-id stamp).
  const filledFields = Object.keys(patch).join(",");
  // Stamp the run that actually touched the lead, but only on a real update.
  patch.importRunId = importRunId;
  await tx
    .update(participants)
    .set(patch)
    .where(eq(participants.id, existingLead.id));
  await logActivity(tx, {
    tenantId: admin.tenantId,
    actorKind: "internal_user",
    actorUserId: admin.id,
    subjectKind: "participant",
    subjectId: existingLead.id,
    event: "lead_import_refreshed",
    meta: { registerId, outcome: "updated", fields: filledFields },
  });
  return "updated";
}
