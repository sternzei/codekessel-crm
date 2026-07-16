import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenantId } from "./helpers";
import { users } from "./users";

// One register-import batch. Groups the leads/employers a single admin import
// created (participants.import_run_id points back here) and records what was
// requested (criteria) and what happened (stats: inserted/updated/skipped).
export const importRuns = pgTable("import_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  // Provenance of the batch, e.g. "openregister".
  source: text("source").notNull(),
  // Lifecycle: "running" | "completed" | "failed".
  status: text("status").notNull(),
  // The search/filter parameters used for this run.
  criteria: jsonb("criteria"),
  // Outcome counters (inserted, updated, skipped, conflicted, ...).
  stats: jsonb("stats"),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  error: text("error"),
  startedByUserId: uuid("started_by_user_id").references(() => users.id),
});
