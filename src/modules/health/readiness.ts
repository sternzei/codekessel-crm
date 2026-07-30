import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { outboundMessages, reminderJobs } from "@/db/schema";
import { env } from "@/lib/env";
import { captureException } from "@/lib/logger";
import { getStorage } from "@/modules/storage";

export type CheckName = "database" | "storage" | "worker" | "outbox";

export type CheckStatus = "ok" | "degraded" | "failed";

export type ReadinessReport = {
  readonly status: "ok" | "degraded" | "failed";
  readonly checks: Readonly<Record<CheckName, CheckStatus>>;
};

// A reminder job that fired this long ago and is still 'scheduled' means the
// worker is not draining the queue — the failure mode `select 1` cannot see.
const WORKER_LAG_TOLERANCE_MS = 5 * 60_000;

const PROBE_KEY = "health/readiness-probe";

const checkDatabase = async (): Promise<CheckStatus> => {
  try {
    await db.execute(sql`select 1`);
    return "ok";
  } catch (error: unknown) {
    captureException(error, "readiness: database unreachable");
    return "failed";
  }
};

/** Writes and removes a probe object: proves credentials AND write access. */
const checkStorage = async (): Promise<CheckStatus> => {
  try {
    const storage = getStorage();
    await storage.put({
      key: PROBE_KEY,
      bytes: new TextEncoder().encode("ok"),
      contentType: "text/plain",
    });
    await storage.delete(PROBE_KEY);
    return "ok";
  } catch (error: unknown) {
    captureException(error, "readiness: storage unusable");
    return "failed";
  }
};

const checkWorker = async (): Promise<CheckStatus> => {
  try {
    const threshold = new Date(Date.now() - WORKER_LAG_TOLERANCE_MS);
    const [row] = await db
      .select({ overdue: sql<number>`count(*)::int` })
      .from(reminderJobs)
      .where(
        and(eq(reminderJobs.status, "scheduled"), lt(reminderJobs.fireAt, threshold)),
      );
    return (row?.overdue ?? 0) > 0 ? "degraded" : "ok";
  } catch (error: unknown) {
    captureException(error, "readiness: worker check failed");
    return "failed";
  }
};

/** Rows stuck mid-send: the provider call neither succeeded nor failed. */
const checkOutbox = async (): Promise<CheckStatus> => {
  try {
    const threshold = new Date(
      Date.now() - env.OUTBOX_STALE_SENDING_MINUTES * 60_000,
    );
    const [row] = await db
      .select({ stalled: sql<number>`count(*)::int` })
      .from(outboundMessages)
      .where(
        and(
          eq(outboundMessages.status, "sending"),
          lt(outboundMessages.updatedAt, threshold),
        ),
      );
    return (row?.stalled ?? 0) > 0 ? "degraded" : "ok";
  } catch (error: unknown) {
    captureException(error, "readiness: outbox check failed");
    return "failed";
  }
};

const worstOf = (statuses: readonly CheckStatus[]): ReadinessReport["status"] => {
  if (statuses.includes("failed")) return "failed";
  if (statuses.includes("degraded")) return "degraded";
  return "ok";
};

/**
 * Deep readiness: the dependencies that actually fail in production — an
 * unreachable database, a bucket the app cannot write to, a dead worker, and an
 * outbox stuck mid-send. Deliberately returns statuses only (no counts): the
 * endpoint is unauthenticated.
 */
export async function collectReadiness(): Promise<ReadinessReport> {
  const [database, storage, worker, outbox] = await Promise.all([
    checkDatabase(),
    checkStorage(),
    checkWorker(),
    checkOutbox(),
  ]);
  return {
    status: worstOf([database, storage, worker, outbox]),
    checks: { database, storage, worker, outbox },
  };
}
