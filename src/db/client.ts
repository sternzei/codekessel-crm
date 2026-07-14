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

const client =
  globalForDb.qcgSql ?? postgres(env.DATABASE_URL, { max: 10, prepare: false });
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
