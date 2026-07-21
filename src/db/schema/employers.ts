import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { SalaryComponent, StaffingBand } from "./ba-data";
import { availabilityStatus, employerStatus } from "./enums";
import { createdAt, tenantId, updatedAt } from "./helpers";

// The employer is the main bottleneck of the QCG process — this table tracks
// exactly the data the Arbeitsagentur needs plus the setup-assistant progress.
export const employers = pgTable(
  "employers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    status: employerStatus("status").notNull().default("new"),

    companyName: text("company_name").notNull(),
    street: text("street"),
    postalCode: text("postal_code"),
    city: text("city"),
    industry: text("industry"),
    employeeCount: integer("employee_count"),

    contactName: text("contact_name"),
    contactRole: text("contact_role"),
    contactEmail: text("contact_email"),
    contactPhone: text("contact_phone"),

    // Betriebsnummer — hard requirement for the application.
    betriebsnummer: text("betriebsnummer"),

    // Arbeitgeberservice (AG-S) registration.
    responsibleAgency: text("responsible_agency"),
    agsRegistered: boolean("ags_registered"),
    agsContactName: text("ags_contact_name"),
    agsContactEmail: text("ags_contact_email"),
    agsContactPhone: text("ags_contact_phone"),

    // Confirmations from the setup assistant.
    trainingSupportConfirmed: boolean("training_support_confirmed"),
    timeModelStatus: availabilityStatus("time_model_status")
      .notNull()
      .default("unclear"),

    // --- Epic A: missing BA application data (plan.md §186). All nullable and
    // additive; inherit the employers RLS policy (same table). Structured sets
    // use jsonb (see ./ba-data).
    // Legal form (Rechtsform), e.g. "GmbH", "GbR".
    legalForm: text("legal_form"),
    // Business account bank details (Betrieb).
    iban: text("iban"),
    bic: text("bic"),
    // Head-count by working-hours band (Beschäftigtenzahlen nach Stunden-Faktoren).
    staffingByHoursBand: jsonb("staffing_by_hours_band").$type<StaffingBand[]>(),
    // Salary components relevant to the application.
    salaryComponents: jsonb("salary_components").$type<SalaryComponent[]>(),
    // A works agreement or collective agreement on training exists
    // (Betriebsvereinbarung/Tarifvertrag).
    hasBetriebsvereinbarung: boolean("has_betriebsvereinbarung"),

    // Provenance — how this employer entered the system. "manual" (default,
    // null) or "openregister". The register_* fields hold the Handelsregister
    // identity from an OpenRegister import; register_id is the dedup key.
    source: text("source"),
    registerId: text("register_id"),
    registerNumber: text("register_number"),
    registerType: text("register_type"),
    registerCourt: text("register_court"),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // Dedup imports per tenant. register_id is null for manual employers;
    // Postgres treats NULLs as distinct, so manual rows never collide.
    uniqueIndex("employers_tenant_register_idx").on(t.tenantId, t.registerId),
  ],
);
