import { sql } from "drizzle-orm";
import { db } from "@/db/client";

// Liveness/readiness probe for the web tier. Unauthenticated but info-light: it
// only confirms the process is up and can reach the database (a lightweight
// `select 1`). No schema, version, or tenant detail is leaked.
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    await db.execute(sql`select 1`);
    return Response.json({ status: "ok" }, { status: 200 });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503 });
  }
}
