import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { aptitudeTestStatus } from "./enums";
import { createdAt, tenantId, updatedAt } from "./helpers";
import { participants } from "./participants";

export const aptitudeTests = pgTable("aptitude_tests", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  participantId: uuid("participant_id")
    .notNull()
    .references(() => participants.id),
  status: aptitudeTestStatus("status").notNull().default("invited"),
  testUrl: text("test_url"),
  invitedAt: timestamp("invited_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  result: jsonb("result"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
