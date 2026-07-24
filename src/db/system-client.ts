import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import type { Db } from "./client";

// Trusted OWNER-connection handle (bypasses RLS by design, like the reminder
// worker and the seed). Used ONLY by the signed WhatsApp webhook reconciler: a
// valid Meta callback carries no tenant/session, and delivery rows are keyed by
// a globally-unique provider message id, so cross-tenant reconciliation needs
// the owner role. Never use this for request paths that have a tenant — those
// must go through withTenant().
//
// Lazy + cached on globalThis so Next.js dev hot-reload doesn't exhaust the
// pool, and so no connection is opened until the webhook is actually configured.

const globalForSystemDb = globalThis as unknown as {
  qcgSystemSql?: ReturnType<typeof postgres>;
  qcgSystemDb?: Db;
};

/** The owner-connection db, or null when MIGRATION_DATABASE_URL is unset. */
export function getSystemDb(): Db | null {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) return null;
  if (globalForSystemDb.qcgSystemDb) return globalForSystemDb.qcgSystemDb;
  const client = globalForSystemDb.qcgSystemSql ?? postgres(url, { max: 3 });
  const db = drizzle(client, { schema });
  globalForSystemDb.qcgSystemSql = client;
  globalForSystemDb.qcgSystemDb = db;
  return db;
}
