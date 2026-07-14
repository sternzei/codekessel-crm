import { timestamp, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";

// Every domain table carries tenant_id — RLS policies key on it.
export const tenantId = () =>
  uuid("tenant_id")
    .notNull()
    .references(() => tenants.id);

export const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
