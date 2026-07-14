import { date, integer, numeric, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { measureFormat } from "./enums";
import { createdAt, tenantId, updatedAt } from "./helpers";

// AZAV-certified training measure (Maßnahme).
export const measures = pgTable("measures", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  name: text("name").notNull(),
  azavNumber: text("azav_number"),
  durationWeeks: integer("duration_weeks").notNull(),
  weeklyHours: integer("weekly_hours").notNull().default(20),
  format: measureFormat("format").notNull().default("online"),
  costEur: numeric("cost_eur", { precision: 10, scale: 2 }),
  startDate: date("start_date"),
  targetGroup: text("target_group"),
  objective: text("objective"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
