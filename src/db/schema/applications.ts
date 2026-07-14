import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { applicationStatus } from "./enums";
import { createdAt, tenantId, updatedAt } from "./helpers";
import { employers } from "./employers";
import { measures } from "./measures";
import { participants } from "./participants";

export const applications = pgTable("applications", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  participantId: uuid("participant_id")
    .notNull()
    .references(() => participants.id),
  employerId: uuid("employer_id").references(() => employers.id),
  measureId: uuid("measure_id").references(() => measures.id),
  status: applicationStatus("status").notNull().default("in_preparation"),
  // Same document pool, two eService paths (docs/ESERVICE-ANTRAG.md):
  // "single" = Arbeitsentgeltzuschuss-Antrag (6 Schritte, eine Person);
  // "company" = Sammelantrag (7 Schritte, mehrere Beschäftigte, Listen-Upload).
  applicantType: text("applicant_type").notNull().default("single"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  responseAt: timestamp("response_at", { withTimezone: true }),
  responseNote: text("response_note"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
