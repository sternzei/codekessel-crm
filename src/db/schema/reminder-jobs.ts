import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { channel, reminderStatus } from "./enums";
import { createdAt, tenantId, updatedAt } from "./helpers";
import { tasks } from "./tasks";

// One scheduled reminder touch (WhatsApp/email/internal call task).
// The reminder worker drains rows whose fire_at has passed.
export const reminderJobs = pgTable(
  "reminder_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id),
    channel: channel("channel").notNull(),
    templateKey: text("template_key"),
    fireAt: timestamp("fire_at", { withTimezone: true }).notNull(),
    status: reminderStatus("status").notNull().default("scheduled"),
    attempts: integer("attempts").notNull().default(0),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("reminder_jobs_due_idx").on(t.status, t.fireAt)],
);
