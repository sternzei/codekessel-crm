import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { appointmentStatus, appointmentType } from "./enums";
import { createdAt, tenantId, updatedAt } from "./helpers";
import { participants } from "./participants";
import { users } from "./users";

export const appointments = pgTable("appointments", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  participantId: uuid("participant_id")
    .notNull()
    .references(() => participants.id),
  consultantId: uuid("consultant_id").references(() => users.id),
  type: appointmentType("type").notNull().default("follow_up"),
  status: appointmentStatus("status").notNull().default("scheduled"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
  notes: text("notes"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
