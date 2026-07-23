import { sql } from "drizzle-orm";
import {
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  availabilityStatus,
  employmentStatus,
  participantStatus,
} from "./enums";
import type {
  FundingStatus,
  QualificationEntry,
  SalaryComponent,
  WeeklyTimes,
} from "./ba-data";
import { createdAt, tenantId, updatedAt } from "./helpers";
import { employers } from "./employers";
import { importRuns } from "./import-runs";
import { measures } from "./measures";
import { users } from "./users";

// Lead and participant are one entity moving through one status pipeline.
export const participants = pgTable(
  "participants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    status: participantStatus("status").notNull().default("new"),

    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    email: text("email"),
    phone: text("phone"),
    dateOfBirth: date("date_of_birth"),
    street: text("street"),
    postalCode: text("postal_code"),
    city: text("city"),

    employmentStatus: employmentStatus("employment_status"),
    // Mandatory gate: 20h/week over ~6 months. Not clearly "yes" → task.
    availabilityStatus: availabilityStatus("availability_status")
      .notNull()
      .default("unclear"),
    eligibilityNotes: text("eligibility_notes"),
    source: text("source"),

    // Provenance for register-imported leads. registerId is the dedup key
    // (Handelsregister company id); it is null for manually created leads so
    // NULL-distinctness plus the partial index below never collides them.
    registerId: text("register_id"),
    // Comparable digits-only phone (see modules/participants/phone.ts). Kept
    // alongside the human-formatted `phone` so lookups/dedup are consistent.
    phoneNormalized: text("phone_normalized"),
    // The import batch that created this lead, if any.
    importRunId: uuid("import_run_id").references(() => importRuns.id),

    // --- Structured financial provenance for register-imported leads (F.3).
    // The discovery signal that made this company a target (financial loss) is
    // now persisted as real columns in ADDITION to the human-readable
    // eligibility_notes text. All nullable and additive; they inherit the
    // participants RLS policy (same table), so no new policy is needed.
    // `net_income` keeps its sign (a loss is negative) and is NEVER coerced to
    // 0 — a missing figure stays null (see modules/register/openregister.ts).
    netIncome: numeric("net_income", { precision: 14, scale: 2 }),
    financialYear: integer("financial_year"),
    // Where the figure was read from + its unit origin ("indicators" cents |
    // "search_row" euros); mirrors the FinancialsSource union. null = no figure.
    financialsSource: text("financials_source"),

    employerId: uuid("employer_id").references(() => employers.id),
    measureId: uuid("measure_id").references(() => measures.id),
    assignedConsultantId: uuid("assigned_consultant_id").references(
      () => users.id,
    ),

    // --- Epic A: missing BA application data (plan.md §186). All nullable and
    // additive; the columns inherit the participants RLS policy (same table),
    // so no new policy is needed. Structured sets use jsonb (see ./ba-data).
    // Sozialversicherungsnummer.
    svNumber: text("sv_number"),
    // Personal bank details (Person).
    iban: text("iban"),
    bic: text("bic"),
    // Monthly gross salary (Gehalt) + any named components on top of it.
    monthlyGrossSalary: numeric("monthly_gross_salary", {
      precision: 10,
      scale: 2,
    }),
    salaryComponents: jsonb("salary_components").$type<SalaryComponent[]>(),
    // Working-time frame (Arbeitszeitrahmen).
    weeklyWorkingHours: numeric("weekly_working_hours", {
      precision: 5,
      scale: 2,
    }),
    monthlyWorkingHours: numeric("monthly_working_hours", {
      precision: 6,
      scale: 2,
    }),
    // Per-weekday training times (Schulungszeiten, Uhrzeiten je Wochentag).
    schulungszeiten: jsonb("schulungszeiten").$type<WeeklyTimes>(),
    // Release hours the employer grants for the training (Freistellungsstunden).
    freistellungsstunden: numeric("freistellungsstunden", {
      precision: 6,
      scale: 2,
    }),
    // Qualification history (Berufsabschluss-Historie).
    qualificationHistory: jsonb("qualification_history").$type<
      QualificationEntry[]
    >(),
    // Funding/subsidy status (KuG/EGZ-Status).
    fundingStatus: jsonb("funding_status").$type<FundingStatus>(),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("participants_status_idx").on(t.tenantId, t.status),
    // Dedup register imports per tenant. Partial so only imported leads (with
    // a register_id) are constrained; manual leads (null) are never blocked.
    uniqueIndex("participants_tenant_register_idx")
      .on(t.tenantId, t.registerId)
      .where(sql`${t.registerId} is not null`),
    // Pipeline board filters: status + owner + recency within a tenant.
    index("participants_pipeline_idx").on(
      t.tenantId,
      t.status,
      t.assignedConsultantId,
      t.createdAt,
    ),
    // Filter/group leads by acquisition source (e.g. "openregister").
    index("participants_source_idx").on(t.tenantId, t.source),
  ],
);
