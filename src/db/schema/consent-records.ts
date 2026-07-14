import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { consentKind } from "./enums";
import { createdAt, tenantId } from "./helpers";
import { employers } from "./employers";
import { participants } from "./participants";

// DSGVO consent audit trail. Append-only: RLS grants INSERT + SELECT only.
// Withdrawal is a new row with granted = false, never an update.
export const consentRecords = pgTable("consent_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  participantId: uuid("participant_id").references(() => participants.id),
  employerId: uuid("employer_id").references(() => employers.id),
  kind: consentKind("kind").notNull(),
  granted: boolean("granted").notNull(),
  // Which version of the consent text was shown — legal review needs this.
  textVersion: text("text_version").notNull(),
  ipAddress: text("ip_address"),
  grantedAt: timestamp("granted_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  createdAt: createdAt(),
});
