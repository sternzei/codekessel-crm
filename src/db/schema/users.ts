import { boolean, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { userRole } from "./enums";
import { createdAt, tenantId, updatedAt } from "./helpers";

// Internal users only (consultants, admins). Participants and employers
// never get accounts — they act through magic-link tokens.
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    role: userRole("role").notNull().default("consultant"),
    passwordHash: text("password_hash"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("users_tenant_email_idx").on(t.tenantId, t.email)],
);
