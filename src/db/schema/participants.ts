import { sql } from "drizzle-orm";
import {
  date,
  index,
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

    employerId: uuid("employer_id").references(() => employers.id),
    measureId: uuid("measure_id").references(() => measures.id),
    assignedConsultantId: uuid("assigned_consultant_id").references(
      () => users.id,
    ),

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
