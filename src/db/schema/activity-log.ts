import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { actorKind, entityKind } from "./enums";
import { tenantId } from "./helpers";

// Append-only event stream. Every status transition lands here and is what
// the rules engine reacts to. meta must stay PII-minimal: IDs and statuses,
// never names, phone numbers, or free text copied from records.
export const activityLog = pgTable(
  "activity_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    actorKind: actorKind("actor_kind").notNull(),
    actorUserId: uuid("actor_user_id"),
    subjectKind: entityKind("subject_kind").notNull(),
    subjectId: uuid("subject_id").notNull(),
    // e.g. "status_changed", "task_completed", "token_used", "consent_granted"
    event: text("event").notNull(),
    meta: jsonb("meta"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("activity_log_subject_idx").on(t.subjectKind, t.subjectId)],
);
