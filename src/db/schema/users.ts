import {
  boolean,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { userAccessStatus, userRole } from "./enums";
import { createdAt, tenantId, updatedAt } from "./helpers";

// Internal users only (consultants, admins). Participants and employers
// never get accounts — they act through magic-link tokens.
//
// Two ways in: a password an admin set, or a Google account. Google sign-in is
// open to anyone, so a new row starts as `pending` and grants nothing until a
// manager or admin approves it (see modules/auth/google).
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    role: userRole("role").notNull().default("consultant"),
    passwordHash: text("password_hash"),
    /** Google's `sub` claim: stable per account, and never reused. */
    googleSubject: text("google_subject"),
    /** Set when an identity provider vouched for the address, not by us. */
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    accessStatus: userAccessStatus("access_status").notNull().default("pending"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("users_tenant_email_idx").on(t.tenantId, t.email),
    // Global, not per tenant: one Google account must not be able to hold two
    // identities in the same deployment.
    uniqueIndex("users_google_subject_idx").on(t.googleSubject),
  ],
);
