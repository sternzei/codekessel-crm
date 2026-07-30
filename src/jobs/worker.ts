/**
 * Reminder + escalation worker.
 *
 * The reminder_jobs table IS the queue (status='scheduled', fire_at <= now);
 * no extra queue infrastructure needed for the MVP. Runs as a trusted system
 * process on the OWNER connection (like the seed) — it works across tenants
 * and is never reachable from request handling.
 *
 * Run: pnpm jobs:dev   (polls every 15s)
 */
import { and, eq, inArray, lte } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";
import { logger } from "@/lib/logger";
import { enqueueAndDispatchOnHandle } from "@/modules/messaging/outbox";
import { resolveRecipient } from "@/modules/messaging/send";
import { ACTIVE_TASK_STATUSES, isActiveTaskStatus } from "@/modules/tasks/status";
import { getOrIssueMagicLinkForTask } from "@/modules/tokens/service";
import { computePollDelay } from "./poll";

const url = process.env.MIGRATION_DATABASE_URL;
if (!url) throw new Error("MIGRATION_DATABASE_URL is not set");

const sql = postgres(url, { max: 3 });
const db = drizzle(sql, { schema });

const { reminderJobs, tasks, participants, users, activityLog, rateLimitBuckets } =
  schema;

const POLL_INTERVAL_MS = 15_000;
// Up to 3s of random jitter per tick so replicas don't poll in lockstep.
const POLL_JITTER_MS = 3_000;
// A claimed ('sending') job whose worker died is reclaimed after this window.
const STALE_CLAIM_MS = 10 * 60_000;
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 5 * 60_000;
// Emit a heartbeat roughly once a minute (every N idle ticks) so an external
// monitor can detect a stalled/dead worker even when nothing is due.
const HEARTBEAT_EVERY_TICKS = 4;

// "sent" = reminder message was dispatched immediately (click/schedule trigger
// counts as approval). "queued" retained for backward-compatible log readers.
type DispatchOutcome = "sent" | "queued" | "no_recipient" | "failed";

export async function runOnce(): Promise<{
  remindersSent: number;
  tasksEscalated: number;
  rateLimitsPruned: number;
}> {
  const remindersSent = await drainDueReminders();
  const tasksEscalated = await escalateOverdueTasks();
  const rateLimitsPruned = await pruneExpiredRateLimitBuckets();
  return { remindersSent, tasksEscalated, rateLimitsPruned };
}

/**
 * Drops rate-limit buckets whose window has closed. Nothing else deletes the
 * anonymous `/t` keys (only a successful login clears its own bucket), so
 * without this sweep the table grows one permanent row per client IP.
 */
async function pruneExpiredRateLimitBuckets(): Promise<number> {
  const deleted = await db
    .delete(rateLimitBuckets)
    .where(lte(rateLimitBuckets.resetAt, new Date()))
    .returning({ key: rateLimitBuckets.key });
  return deleted.length;
}

async function drainDueReminders(): Promise<number> {
  // Recover jobs stuck in 'sending' by a crashed worker so they retry.
  await db
    .update(reminderJobs)
    .set({ status: "scheduled" })
    .where(
      and(
        eq(reminderJobs.status, "sending"),
        lte(reminderJobs.updatedAt, new Date(Date.now() - STALE_CLAIM_MS)),
      ),
    );

  // Atomically claim due jobs: only rows this worker flipped to 'sending'
  // are ours — a second worker skips them (SKIP LOCKED), so no double-send.
  const dueIds = db
    .select({ id: reminderJobs.id })
    .from(reminderJobs)
    .where(
      and(
        eq(reminderJobs.status, "scheduled"),
        lte(reminderJobs.fireAt, new Date()),
      ),
    )
    .orderBy(reminderJobs.fireAt)
    .limit(50)
    .for("update", { skipLocked: true });

  const claimed = await db
    .update(reminderJobs)
    .set({ status: "sending" })
    .where(inArray(reminderJobs.id, dueIds))
    .returning({ id: reminderJobs.id });

  if (claimed.length === 0) return 0;

  const due = await db
    .select({ job: reminderJobs, task: tasks })
    .from(reminderJobs)
    .innerJoin(tasks, eq(reminderJobs.taskId, tasks.id))
    .where(inArray(reminderJobs.id, claimed.map((c) => c.id)))
    .orderBy(reminderJobs.fireAt);

  let sent = 0;
  for (const { job, task } of due) {
    // Task already handled → reminder is obsolete.
    if (!isActiveTaskStatus(task.status)) {
      await db
        .update(reminderJobs)
        .set({ status: "cancelled" })
        .where(eq(reminderJobs.id, job.id));
      continue;
    }

    try {
      let outcome: DispatchOutcome;
      if (job.channel === "internal") {
        outcome = (await createReminderCallTask(task, job.templateKey))
          ? "sent"
          : "no_recipient";
      } else if (job.channel === "whatsapp" || job.channel === "email") {
        outcome = await sendExternalReminder(task, job.channel, job.templateKey);
      } else {
        outcome = "no_recipient";
      }

      if (outcome === "sent" || outcome === "queued") {
        await db
          .update(reminderJobs)
          .set({ status: "sent", sentAt: new Date(), attempts: job.attempts + 1 })
          .where(eq(reminderJobs.id, job.id));
        sent += 1;
      } else if (outcome === "no_recipient") {
        // Permanently undeliverable (no owner/recipient/responsible user) —
        // don't pretend it was sent, don't retry forever.
        await db
          .update(reminderJobs)
          .set({
            status: "cancelled",
            attempts: job.attempts + 1,
            lastError: "no_recipient",
          })
          .where(eq(reminderJobs.id, job.id));
        logger.error("reminder undeliverable", {
          jobId: job.id,
          message: "no_recipient",
        });
      } else {
        await markReminderFailed(job, "adapter_rejected");
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "unknown";
      await markReminderFailed(job, message);
      logger.error("reminder dispatch failed", { jobId: job.id, message });
    }
  }
  return sent;
}

async function markReminderFailed(
  job: typeof reminderJobs.$inferSelect,
  message: string,
): Promise<void> {
  const attempts = job.attempts + 1;
  const exhausted = attempts >= MAX_ATTEMPTS;
  await db
    .update(reminderJobs)
    .set({
      status: exhausted ? "failed" : "scheduled",
      attempts,
      lastError: message,
      // Only reschedule when retries remain.
      ...(exhausted ? {} : { fireAt: new Date(Date.now() + RETRY_DELAY_MS) }),
    })
    .where(eq(reminderJobs.id, job.id));
}

async function sendExternalReminder(
  task: typeof tasks.$inferSelect,
  channel: "whatsapp" | "email",
  templateKey: string | null,
): Promise<DispatchOutcome> {
  if (task.ownerKind === "internal_user") return "no_recipient";
  const ownerId =
    task.ownerKind === "participant"
      ? task.ownerParticipantId
      : task.ownerEmployerId;
  if (!ownerId) return "no_recipient";

  const recipient = await resolveRecipient(db, task.ownerKind, ownerId);
  if (!recipient) return "no_recipient";

  // F4: reminders for magic-link tasks must include a valid link. The JWT can't
  // be rebuilt from the stored hash, so we mint a fresh one (superseding any
  // live token). Tasks without external link semantics get no {{link}}.
  const link =
    task.channel === "magic_link"
      ? await getOrIssueMagicLinkForTask(db, task)
      : null;

  // Reminder fire-at IS the send trigger — dispatch immediately via the
  // business Cloud API / email adapter (no Postausgang hop).
  const outcome = await enqueueAndDispatchOnHandle(db, {
    tenantId: task.tenantId,
    taskId: task.id,
    channel,
    templateKey: templateKey ?? `reminder_${task.type}`,
    recipient,
    source: "reminder",
    variables: {
      firstName: recipient.displayName ?? "",
      title: task.title,
      ...(link ? { link } : {}),
    },
  });
  return outcome === "dispatched" ? "sent" : "failed";
}

/** "Reminder call" step: an internal task for the responsible consultant. */
async function createReminderCallTask(
  task: typeof tasks.$inferSelect,
  templateKey: string | null,
): Promise<boolean> {
  const consultantId = await resolveResponsibleUser(task);
  if (!consultantId) return false;

  // Retry-after-partial-failure guard: if a previous attempt already created
  // the call task but crashed before marking the job, don't stack a second.
  if (task.subjectId) {
    const [existing] = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(
        and(
          eq(tasks.tenantId, task.tenantId),
          eq(tasks.type, "reminder_call"),
          eq(tasks.subjectId, task.subjectId),
          inArray(tasks.status, [...ACTIVE_TASK_STATUSES]),
        ),
      )
      .limit(1);
    if (existing) return true;
  }

  const [created] = await db
    .insert(tasks)
    .values({
      tenantId: task.tenantId,
      type: "reminder_call",
      title: `Erinnerungsanruf: ${task.title}`,
      status: "open",
      ownerKind: "internal_user",
      ownerUserId: consultantId,
      channel: "internal",
      subjectKind: task.subjectKind,
      subjectId: task.subjectId,
      dueAt: new Date(Date.now() + 2 * 3_600_000),
    })
    .returning({ id: tasks.id });

  await db.insert(activityLog).values({
    tenantId: task.tenantId,
    actorKind: "system",
    subjectKind: "task",
    subjectId: created.id,
    event: "task_created",
    meta: { taskType: "reminder_call", templateKey },
  });
  return true;
}

async function escalateOverdueTasks(): Promise<number> {
  const overdue = await db
    .select()
    .from(tasks)
    .where(
      and(
        inArray(tasks.status, [...ACTIVE_TASK_STATUSES]),
        lte(tasks.escalationAt, new Date()),
      ),
    )
    .limit(50);

  let escalated = 0;
  for (const task of overdue) {
    const escalateTo = await resolveResponsibleUser(task, "admin");

    // Escalate at most once (W1.3): flip the status AND clear escalation_at.
    // The WHERE clause makes the flip atomic — a concurrent worker flipping
    // the same row gets an empty RETURNING and skips the follow-up + log.
    const [flipped] = await db
      .update(tasks)
      .set({
        status: "escalated",
        escalatedToUserId: escalateTo,
        escalationAt: null,
      })
      .where(
        and(eq(tasks.id, task.id), inArray(tasks.status, [...ACTIVE_TASK_STATUSES])),
      )
      .returning({ id: tasks.id });
    if (!flipped) continue;
    escalated += 1;

    // Only spawn a follow-up when one isn't already open for this subject,
    // so repeated overdue tasks on the same lead don't pile up follow-ups.
    if (escalateTo && !(await hasActiveEscalationFollowup(task))) {
      await db.insert(tasks).values({
        tenantId: task.tenantId,
        type: "escalation_followup",
        title: `Eskalation: ${task.title}`,
        status: "open",
        ownerKind: "internal_user",
        ownerUserId: escalateTo,
        channel: "internal",
        subjectKind: task.subjectKind,
        subjectId: task.subjectId,
        dueAt: new Date(Date.now() + 24 * 3_600_000),
      });
    }

    await db.insert(activityLog).values({
      tenantId: task.tenantId,
      actorKind: "system",
      subjectKind: "task",
      subjectId: task.id,
      event: "task_escalated",
      meta: { taskType: task.type },
    });
  }
  return escalated;
}

/**
 * True when an escalation follow-up for the same subject is already open —
 * guards against stacking duplicate follow-ups across polls.
 */
async function hasActiveEscalationFollowup(
  task: typeof tasks.$inferSelect,
): Promise<boolean> {
  if (!task.subjectId) return false;
  const [existing] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(
        eq(tasks.tenantId, task.tenantId),
        eq(tasks.type, "escalation_followup"),
        eq(tasks.subjectId, task.subjectId),
        inArray(tasks.status, [...ACTIVE_TASK_STATUSES]),
      ),
    )
    .limit(1);
  return Boolean(existing);
}

/**
 * Who is internally responsible for a task? The assigned consultant of the
 * related participant, else (or when explicitly requested) a tenant admin.
 */
async function resolveResponsibleUser(
  task: typeof tasks.$inferSelect,
  prefer: "consultant" | "admin" = "consultant",
): Promise<string | null> {
  if (prefer === "consultant" && task.ownerParticipantId) {
    const [p] = await db
      .select({ consultantId: participants.assignedConsultantId })
      .from(participants)
      .where(eq(participants.id, task.ownerParticipantId));
    if (p?.consultantId) return p.consultantId;
  }
  const [admin] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.tenantId, task.tenantId),
        eq(users.role, "admin"),
        eq(users.active, true),
      ),
    )
    .limit(1);
  return admin?.id ?? null;
}

// --- Entrypoint -------------------------------------------------------------

// Flipped false by SIGTERM/SIGINT so the loop finishes its current tick and
// exits cleanly (closing the pool) instead of being hard-killed mid-query.
let running = true;
// Wakes an in-progress sleep early so shutdown doesn't wait a whole interval.
let wake: (() => void) | null = null;

function interruptibleSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      wake = null;
      resolve();
    }, ms);
    wake = () => {
      clearTimeout(timer);
      wake = null;
      resolve();
    };
  });
}

function requestShutdown(signal: string): void {
  if (!running) return;
  logger.info("reminder worker shutdown requested", { signal });
  running = false;
  wake?.();
}

async function loop(): Promise<void> {
  logger.info("reminder worker started", { intervalMs: POLL_INTERVAL_MS });
  let ticks = 0;
  while (running) {
    try {
      const { remindersSent, tasksEscalated, rateLimitsPruned } = await runOnce();
      if (remindersSent || tasksEscalated || rateLimitsPruned) {
        logger.info("worker tick", {
          remindersSent,
          tasksEscalated,
          rateLimitsPruned,
        });
      }
    } catch (error: unknown) {
      logger.error("worker tick failed", {
        message: error instanceof Error ? error.message : "unknown",
      });
    }
    ticks += 1;
    // Heartbeat so a monitor can distinguish "alive but idle" from "dead".
    if (ticks % HEARTBEAT_EVERY_TICKS === 0) {
      logger.info("worker heartbeat", { ticks });
    }
    if (!running) break;
    await interruptibleSleep(
      computePollDelay({ baseMs: POLL_INTERVAL_MS, maxJitterMs: POLL_JITTER_MS }),
    );
  }
  await sql.end();
  logger.info("reminder worker stopped");
}

if (process.argv.includes("--loop")) {
  process.on("SIGTERM", () => requestShutdown("SIGTERM"));
  process.on("SIGINT", () => requestShutdown("SIGINT"));
  void loop();
} else if (process.argv.includes("--once")) {
  runOnce()
    .then((result) => {
      logger.info("worker single run complete", result);
      return sql.end();
    })
    .catch((error) => {
      logger.error("worker run failed", {
        message: error instanceof Error ? error.message : "unknown",
      });
      return sql.end().then(() => process.exit(1));
    });
}
