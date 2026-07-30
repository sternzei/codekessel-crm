import { customType, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Postgres-backed blob store used by `STORAGE_DRIVER=db`. Global (no tenant_id):
 * objects are addressed by an unguessable key that the caller already had to
 * read from a tenant-scoped row, so authorization happens one level up.
 * Accessed without RLS — see migration 0019.
 */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

export const storageObjects = pgTable("storage_objects", {
  key: text("key").primaryKey(),
  contentType: text("content_type"),
  byteSize: integer("byte_size").notNull(),
  bytes: bytea("bytes").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
