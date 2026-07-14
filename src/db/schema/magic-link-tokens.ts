import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { ownerKind } from "./enums";
import { createdAt, tenantId } from "./helpers";
import { tasks } from "./tasks";

// One row per issued magic link. The JWT alone is not enough: this row gives
// us revocation, single-use enforcement, and an audit trail. Only the SHA-256
// hash of the token is stored — a DB leak must not leak usable links.
export const magicLinkTokens = pgTable(
  "magic_link_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id),
    subjectKind: ownerKind("subject_kind").notNull(),
    subjectId: uuid("subject_id").notNull(),
    scope: text("scope").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("magic_link_tokens_hash_idx").on(t.tokenHash),
    index("magic_link_tokens_task_idx").on(t.taskId),
  ],
);
