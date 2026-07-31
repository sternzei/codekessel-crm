import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "./schema";

// Runtime connection uses the qcg_app role: RLS is enforced on every query.
// Cached on globalThis so Next.js dev hot-reload doesn't exhaust the pool.
const globalForDb = globalThis as unknown as {
  qcgSql?: ReturnType<typeof postgres>;
};

// A long-lived server shares one pool across all concurrent requests, so ten
// connections is cheap. A serverless platform inverts that: every instance
// holds its own pool and there may be hundreds at once, so ten each exhausts
// the database's connection limit long before the app is under real load.
// DB_POOL_MAX exists for that case — set it to 1 and point DATABASE_URL at a
// transaction-mode pooler, which is what actually does the multiplexing.
const POOL_MAX = Number(process.env.DB_POOL_MAX ?? 10);

const client =
  globalForDb.qcgSql ??
  postgres(env.DATABASE_URL, {
    max: Number.isFinite(POOL_MAX) && POOL_MAX > 0 ? POOL_MAX : 10,
    // Also required by transaction-mode poolers: a prepared statement outlives
    // the transaction that made it, but the backend it was prepared on does
    // not stay assigned to this client.
    prepare: false,
  });
if (process.env.NODE_ENV !== "production") globalForDb.qcgSql = client;

export const db = drizzle(client, { schema });

export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
// Domain services accept either, so they compose inside larger transactions.
export type DbHandle = Db | Tx;

/**
 * All tenant data access goes through here. Sets `app.tenant_id` for the
 * transaction; RLS policies filter every table on it. Outside of this
 * wrapper the app role sees zero rows.
 */
export async function withTenant<T>(
  tenantId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('app.tenant_id', ${tenantId}, true)`,
    );
    return fn(tx);
  });
}
