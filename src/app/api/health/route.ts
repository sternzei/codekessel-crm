import { sql } from "drizzle-orm";
import { db } from "@/db/client";

// Liveness probe for the web tier. Unauthenticated but info-light: it only
// confirms the process is up and can reach the database (a lightweight
// `select 1`). No schema, version, or tenant detail is leaked.
//
// Intentionally shallow — it drives the container healthcheck, so a degraded
// dependency (dead worker, stalled outbox, unwritable bucket) must not restart
// a web container that is serving fine. Those live behind /api/ready.
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    await db.execute(sql`select 1`);
    return Response.json({ status: "ok" }, { status: 200 });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503 });
  }
}
