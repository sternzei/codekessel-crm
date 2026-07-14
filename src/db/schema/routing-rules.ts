import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import { channel, entityKind, ownerKind } from "./enums";
import { createdAt, tenantId, updatedAt } from "./helpers";

// The task-routing table from the concept, as data instead of code:
// "when <entity> enters <status>, create <task> for <owner> via <channel>".
// Editable without deployments; seeded from the spec's routing matrix.
export const routingRules = pgTable("routing_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  name: text("name").notNull(),

  triggerEntity: entityKind("trigger_entity").notNull(),
  triggerStatus: text("trigger_status").notNull(),

  taskType: text("task_type").notNull(),
  titleTemplate: text("title_template").notNull(),
  ownerKind: ownerKind("owner_kind").notNull(),
  channel: channel("channel").notNull(),

  dueHours: integer("due_hours"),
  // e.g. [{ afterHours: 24, channel: "whatsapp", templateKey: "..." }, ...]
  reminderPlan: jsonb("reminder_plan"),
  escalationHours: integer("escalation_hours"),

  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
