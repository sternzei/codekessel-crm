import { date, index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import {
  availabilityStatus,
  employmentStatus,
  participantStatus,
} from "./enums";
import { createdAt, tenantId, updatedAt } from "./helpers";
import { employers } from "./employers";
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

    employerId: uuid("employer_id").references(() => employers.id),
    measureId: uuid("measure_id").references(() => measures.id),
    assignedConsultantId: uuid("assigned_consultant_id").references(
      () => users.id,
    ),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("participants_status_idx").on(t.tenantId, t.status)],
);
