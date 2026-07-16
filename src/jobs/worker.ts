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
import { resolveRecipient, sendTaskMessage } from "@/modules/messaging/send";
import { ACTIVE_TASK_STATUSES, isActiveTaskStatus } from "@/modules/tasks/status";
import { getOrIssueMagicLinkForTask } from "@/modules/tokens/service";

const url = process.env.MIGRATION_DATABASE_URL;
if (!url) throw new Error("MIGRATION_DATABASE_URL is not set");

const sql = postgres(url, { max: 3 });
const db = drizzle(sql, { schema });

const { reminderJobs, tasks, participants, users, activityLog } = schema;

const POLL_INTERVAL_MS = 15_000;

export async function runOnce(): Promise<{
  remindersSent: number;
  tasksEscalated: number;
}> {
  const remindersSent = await drainDueReminders();
  const tasksEscalated = await escalateOverdueTasks();
  return { remindersSent, tasksEscalated };
}

async function drainDueReminders(): Promise<number> {
  const due = await db
    .select({ job: reminderJobs, task: tasks })
    .from(reminderJobs)
    .innerJoin(tasks, eq(reminderJobs.taskId, tasks.id))
    .where(
      and(
        eq(reminderJobs.status, "scheduled"),
        lte(reminderJobs.fireAt, new Date()),
      ),
    )
    .limit(50);

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
      if (job.channel === "internal") {
        await createReminderCallTask(task, job.templateKey);
      } else if (job.channel === "whatsapp" || job.channel === "email") {
        await sendExternalReminder(task, job.channel, job.templateKey);
      }
      await db
        .update(reminderJobs)
        .set({ status: "sent", sentAt: new Date(), attempts: job.attempts + 1 })
        .where(eq(reminderJobs.id, job.id));
      sent += 1;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "unknown";
      await db
        .update(reminderJobs)
        .set({
          status: job.attempts + 1 >= 3 ? "failed" : "scheduled",
          attempts: job.attempts + 1,
          lastError: message,
          // Retry in 5 minutes unless attempts are exhausted.
          fireAt: new Date(Date.now() + 5 * 60_000),
        })
        .where(eq(reminderJobs.id, job.id));
      logger.error("reminder dispatch failed", { jobId: job.id, message });
    }
  }
  return sent;
}

async function sendExternalReminder(
  task: typeof tasks.$inferSelect,
  channel: "whatsapp" | "email",
  templateKey: string | null,
): Promise<void> {
  if (task.ownerKind === "internal_user") return;
  const ownerId =
    task.ownerKind === "participant"
      ? task.ownerParticipantId
      : task.ownerEmployerId;
  if (!ownerId) return;

  const recipient = await resolveRecipient(db, task.ownerKind, ownerId);
  if (!recipient) return;

  // F4: reminders for magic-link tasks must include a valid link. The JWT can't
  // be rebuilt from the stored hash, so we mint a fresh one (superseding any
  // live token). Tasks without external link semantics get no {{link}}.
  const link =
    task.channel === "magic_link"
      ? await getOrIssueMagicLinkForTask(db, task)
      : null;

  await sendTaskMessage(db, {
    tenantId: task.tenantId,
    taskId: task.id,
    channel,
    templateKey: templateKey ?? `reminder_${task.type}`,
    recipient,
    variables: {
      firstName: recipient.displayName ?? "",
      title: task.title,
      ...(link ? { link } : {}),
    },
  });
}

/** "Reminder call" step: an internal task for the responsible consultant. */
async function createReminderCallTask(
  task: typeof tasks.$inferSelect,
  templateKey: string | null,
): Promise<void> {
  const consultantId = await resolveResponsibleUser(task);
  if (!consultantId) return;

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

  for (const task of overdue) {
    const escalateTo = await resolveResponsibleUser(task, "admin");

    // Escalate at most once (W1.3): flip the status AND clear escalation_at.
    // The status flip already drops the row out of the overdue query, and
    // clearing the timestamp means even a later reopen can't re-trigger it —
    // so a poll loop can never re-escalate the same task.
    await db
      .update(tasks)
      .set({
        status: "escalated",
        escalatedToUserId: escalateTo,
        escalationAt: null,
      })
      .where(eq(tasks.id, task.id));

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
  return overdue.length;
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

async function loop(): Promise<void> {
  logger.info("reminder worker started", { intervalMs: POLL_INTERVAL_MS });
  for (;;) {
    try {
      const { remindersSent, tasksEscalated } = await runOnce();
      if (remindersSent || tasksEscalated) {
        logger.info("worker tick", { remindersSent, tasksEscalated });
      }
    } catch (error: unknown) {
      logger.error("worker tick failed", {
        message: error instanceof Error ? error.message : "unknown",
      });
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

if (process.argv.includes("--loop")) {
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
