import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { channel, entityKind, ownerKind, taskStatus } from "./enums";
import { createdAt, tenantId, updatedAt } from "./helpers";
import { employers } from "./employers";
import { participants } from "./participants";
import { routingRules } from "./routing-rules";
import { users } from "./users";

// The unit of work. Owner is exactly one of: internal user, participant,
// employer (enforced by owner_kind + a CHECK constraint in the RLS migration).
export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    type: text("type").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    status: taskStatus("status").notNull().default("open"),

    ownerKind: ownerKind("owner_kind").notNull(),
    ownerUserId: uuid("owner_user_id").references(() => users.id),
    ownerParticipantId: uuid("owner_participant_id").references(
      () => participants.id,
    ),
    ownerEmployerId: uuid("owner_employer_id").references(() => employers.id),

    channel: channel("channel").notNull().default("internal"),

    // What this task is about (polymorphic — e.g. an appointment, a document).
    subjectKind: entityKind("subject_kind"),
    subjectId: uuid("subject_id"),

    routingRuleId: uuid("routing_rule_id").references(() => routingRules.id),

    dueAt: timestamp("due_at", { withTimezone: true }),
    escalationAt: timestamp("escalation_at", { withTimezone: true }),
    escalatedToUserId: uuid("escalated_to_user_id").references(() => users.id),
    completedAt: timestamp("completed_at", { withTimezone: true }),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("tasks_status_idx").on(t.tenantId, t.status),
    index("tasks_owner_user_idx").on(t.ownerUserId),
    // Supports the routing/worker idempotency lookup: "is there already an
    // active task for this (tenant, type, owner, subject)?". Deliberately
    // NON-unique — see the routing engine (W1.2) / worker (W1.3) for why
    // dedup is enforced in application code rather than as a hard constraint.
    index("tasks_active_dedup_idx")
      .on(
        t.tenantId,
        t.type,
        t.ownerKind,
        sql`coalesce(${t.ownerParticipantId}, ${t.ownerEmployerId}, ${t.ownerUserId})`,
        t.subjectKind,
        t.subjectId,
      )
      .where(sql`${t.status} in ('open', 'in_progress', 'waiting')`),
  ],
);
