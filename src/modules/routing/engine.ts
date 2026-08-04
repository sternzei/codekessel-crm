import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { DbHandle } from "@/db/client";
import { reminderJobs, routingRules, tasks } from "@/db/schema";
import { logger } from "@/lib/logger";
import { logActivity } from "@/modules/audit/log";
import { buildTaskTemplateKey, hasLandingPage } from "@/modules/messaging/catalog";
import { resolveDeliveryChannel } from "@/modules/messaging/channel";
import { enqueueAndDispatchOnHandle } from "@/modules/messaging/outbox";
import { resolveRecipient } from "@/modules/messaging/send";
import { isTemplateRenderError } from "@/modules/messaging/templates";
import { ACTIVE_TASK_STATUSES, isActiveTaskStatus } from "@/modules/tasks/status";
import { issueMagicLink } from "@/modules/tokens/service";

type EntityKind = (typeof routingRules.triggerEntity.enumValues)[number];
type ActorKind = "system" | "internal_user" | "participant" | "employer";

// reminder_plan JSONB shape on routing_rules: validated, never trusted.
const reminderPlanSchema = z.array(
  z.object({
    afterHours: z.number().positive().optional(),
    beforeHours: z.number().positive().optional(),
    channel: z.enum(["whatsapp", "email", "internal"]),
    templateKey: z.string(),
  }),
);

export type TransitionEvent = {
  tenantId: string;
  entity: EntityKind;
  entityId: string;
  status: string;
  actorKind: ActorKind;
  actorUserId?: string;
  // Detail the rule cannot know, written onto every task this event creates.
  // Rule titles are fixed templates, so this is where a caller says *why*.
  taskDescription?: string;
  // Owner resolution context: which concrete people/records a matched rule
  // may assign its task to. The caller knows these; the rule only knows roles.
  context: {
    participantId?: string;
    employerId?: string;
    consultantId?: string;
    // Anchor for beforeHours reminders (e.g. the appointment time).
    referenceAt?: Date;
    // Extra template variables (e.g. appointment time as display string).
    variables?: Record<string, string>;
  };
};

/**
 * The heart of the system: a status transition comes in, the routing_rules
 * table decides who gets which task on which channel. Rules are data, not
 * code — the spec's routing matrix is seeded into the table.
 *
 * For every matched rule this:
 *  1. creates the task for the resolved owner,
 *  2. for external owners: issues a magic link and dispatches the templated
 *     message (mock adapters until credentials arrive),
 *  3. schedules the rule's reminder_plan as reminder_jobs,
 *  4. stamps due/escalation timestamps (the worker escalates past-due tasks).
 */
export async function processTransition(
  tx: DbHandle,
  event: TransitionEvent,
): Promise<{ createdTaskIds: string[] }> {
  await logActivity(tx, {
    tenantId: event.tenantId,
    actorKind: event.actorKind,
    actorUserId: event.actorUserId,
    subjectKind: event.entity,
    subjectId: event.entityId,
    event: "status_changed",
    meta: { status: event.status },
  });

  const rules = await tx
    .select()
    .from(routingRules)
    .where(
      and(
        eq(routingRules.triggerEntity, event.entity),
        eq(routingRules.triggerStatus, event.status),
        eq(routingRules.active, true),
      ),
    );

  const createdTaskIds: string[] = [];

  // Idempotency (W1.2): never stack a second active task for the same
  // (tenant, type, owner, subject). Fetched once per transition; tasks
  // created by earlier rules in this loop are appended so later rules see
  // them. The unique partial index tasks_active_dedup_idx closes the
  // concurrent-transition race that this app-level check cannot see.
  const activeForSubject = await tx
    .select({
      type: tasks.type,
      ownerKind: tasks.ownerKind,
      ownerParticipantId: tasks.ownerParticipantId,
      ownerEmployerId: tasks.ownerEmployerId,
      ownerUserId: tasks.ownerUserId,
      status: tasks.status,
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.tenantId, event.tenantId),
        eq(tasks.subjectKind, event.entity),
        eq(tasks.subjectId, event.entityId),
        inArray(tasks.status, [...ACTIVE_TASK_STATUSES]),
      ),
    );

  for (const rule of rules) {
    const owner = resolveOwner(rule.ownerKind, event.context);
    if (!owner) continue; // No matching person in context — rule skipped.

    if (
      hasDuplicateActiveTask(
        { type: rule.taskType, ownerKind: rule.ownerKind, owner },
        activeForSubject,
      )
    ) {
      await logActivity(tx, {
        tenantId: event.tenantId,
        actorKind: "system",
        subjectKind: event.entity,
        subjectId: event.entityId,
        event: "task_skipped_duplicate",
        meta: { ruleId: rule.id, taskType: rule.taskType },
      });
      continue;
    }

    // onConflictDoNothing: if a CONCURRENT transition won the race and
    // inserted the same active task (unique partial index), treat it as a
    // duplicate instead of aborting the whole transaction with 23505.
    const [task] = await tx
      .insert(tasks)
      .values({
        tenantId: event.tenantId,
        type: rule.taskType,
        title: rule.titleTemplate,
        description: event.taskDescription ?? null,
        status: "open",
        ownerKind: rule.ownerKind,
        ...owner,
        channel: rule.channel,
        subjectKind: event.entity,
        subjectId: event.entityId,
        routingRuleId: rule.id,
        dueAt: rule.dueHours ? hoursFromNow(rule.dueHours) : null,
        escalationAt: rule.escalationHours
          ? hoursFromNow(rule.escalationHours)
          : null,
      })
      .onConflictDoNothing()
      .returning({ id: tasks.id });

    if (!task) {
      await logActivity(tx, {
        tenantId: event.tenantId,
        actorKind: "system",
        subjectKind: event.entity,
        subjectId: event.entityId,
        event: "task_skipped_duplicate",
        meta: { ruleId: rule.id, taskType: rule.taskType, via: "constraint" },
      });
      continue;
    }

    activeForSubject.push({
      type: rule.taskType,
      ownerKind: rule.ownerKind,
      ownerParticipantId: owner.ownerParticipantId ?? null,
      ownerEmployerId: owner.ownerEmployerId ?? null,
      ownerUserId: owner.ownerUserId ?? null,
      status: "open",
    });

    createdTaskIds.push(task.id);

    await logActivity(tx, {
      tenantId: event.tenantId,
      actorKind: "system",
      subjectKind: "task",
      subjectId: task.id,
      event: "task_created",
      meta: { ruleId: rule.id, taskType: rule.taskType },
    });

    await dispatchExternal(tx, event, rule, task.id, owner);
    await scheduleReminders(tx, event, rule, task.id);
  }

  return { createdTaskIds };
}

/**
 * External owners get a magic link + an immediate channel message. The status
 * transition that created this task IS the send trigger — nothing waits in
 * Postausgang for routing follow-ups (that queue is for other review flows).
 */
async function dispatchExternal(
  tx: DbHandle,
  event: TransitionEvent,
  rule: typeof routingRules.$inferSelect,
  taskId: string,
  owner: ResolvedOwner,
): Promise<void> {
  if (rule.ownerKind === "internal_user") return;

  const subjectId =
    rule.ownerKind === "participant"
      ? owner.ownerParticipantId
      : owner.ownerEmployerId;
  if (!subjectId) return;

  // Only task types with a /t/[token] page get a link; for the others a link
  // would lead nowhere and their templates don't reference {{link}}.
  const link = hasLandingPage(rule.taskType)
    ? await issueMagicLink(tx, {
        tenantId: event.tenantId,
        taskId,
        subjectKind: rule.ownerKind,
        subjectId,
        scope: rule.taskType,
      })
    : null;

  const recipient = await resolveRecipient(tx, rule.ownerKind, subjectId);
  if (!recipient) return;

  // magic_link tasks notify via WhatsApp when a phone exists, else email …
  const preferredChannel =
    rule.channel === "email" || (rule.channel === "magic_link" && !recipient.phone)
      ? ("email" as const)
      : ("whatsapp" as const);
  // … and email also wins over a WhatsApp send that would only be mocked.
  const channel = resolveDeliveryChannel({
    preferred: preferredChannel,
    recipient,
  });

  try {
    await enqueueAndDispatchOnHandle(tx, {
      tenantId: event.tenantId,
      taskId,
      channel,
      templateKey: buildTaskTemplateKey(rule.taskType),
      recipient,
      source: "routing",
      actorUserId: event.actorUserId ?? null,
      variables: {
        firstName: recipient.displayName ?? "",
        title: rule.titleTemplate,
        ...(link ? { link: link.url } : {}),
        ...event.context.variables,
      },
    });
  } catch (error: unknown) {
    // Refusing to send beats sending improvised copy, but it must not roll back
    // the transition that created the task: the task itself is still the work
    // item a consultant can act on. Record it so the gap is visible.
    if (!isTemplateRenderError(error)) throw error;
    logger.error("routing dispatch blocked by template", {
      taskId,
      templateKey: error.templateKey,
      channel: error.channel,
    });
    await logActivity(tx, {
      tenantId: event.tenantId,
      actorKind: "system",
      subjectKind: "task",
      subjectId: taskId,
      event: "message_template_missing",
      meta: { templateKey: error.templateKey, channel: error.channel },
    });
  }
}

async function scheduleReminders(
  tx: DbHandle,
  event: TransitionEvent,
  rule: typeof routingRules.$inferSelect,
  taskId: string,
): Promise<void> {
  if (!rule.reminderPlan) return;
  const plan = reminderPlanSchema.safeParse(rule.reminderPlan);
  if (!plan.success) return;

  const now = Date.now();
  for (const step of plan.data) {
    let fireAt: Date | null = null;
    if (step.afterHours) {
      fireAt = new Date(now + step.afterHours * 3_600_000);
    } else if (step.beforeHours && event.context.referenceAt) {
      fireAt = new Date(
        event.context.referenceAt.getTime() - step.beforeHours * 3_600_000,
      );
    }
    // Skip steps that cannot be anchored or already lie in the past.
    if (!fireAt || fireAt.getTime() <= now) continue;

    await tx.insert(reminderJobs).values({
      tenantId: event.tenantId,
      taskId,
      channel: step.channel === "internal" ? "internal" : step.channel,
      templateKey: step.templateKey,
      fireAt,
    });
  }
}

type ResolvedOwner = Partial<{
  ownerUserId: string;
  ownerParticipantId: string;
  ownerEmployerId: string;
}>;

type OwnerKind = "internal_user" | "participant" | "employer";

// The owner columns a stored task exposes — one is set per owner_kind.
export type OwnerColumns = {
  ownerKind: OwnerKind;
  ownerParticipantId: string | null;
  ownerEmployerId: string | null;
  ownerUserId: string | null;
};

export type ActiveTaskRow = OwnerColumns & {
  type: string;
  status: string;
};

export type RoutingTaskKey = {
  type: string;
  ownerKind: OwnerKind;
  owner: ResolvedOwner;
};

function ownerIdFor(ownerKind: OwnerKind, owner: ResolvedOwner): string | null {
  if (ownerKind === "participant") return owner.ownerParticipantId ?? null;
  if (ownerKind === "employer") return owner.ownerEmployerId ?? null;
  return owner.ownerUserId ?? null;
}

function rowOwnerId(row: OwnerColumns): string | null {
  if (row.ownerKind === "participant") return row.ownerParticipantId;
  if (row.ownerKind === "employer") return row.ownerEmployerId;
  return row.ownerUserId;
}

/**
 * The single definition of "this routing task already exists": an active task
 * with the same type, owner_kind, resolved owner id, and (implicitly, via the
 * caller's query) the same subject. Used by the routing engine to stay
 * idempotent under repeated/concurrent transitions.
 */
export function hasDuplicateActiveTask(
  key: RoutingTaskKey,
  existing: ActiveTaskRow[],
): boolean {
  const ownerId = ownerIdFor(key.ownerKind, key.owner);
  if (!ownerId) return false;
  return existing.some(
    (row) =>
      isActiveTaskStatus(row.status) &&
      row.type === key.type &&
      row.ownerKind === key.ownerKind &&
      rowOwnerId(row) === ownerId,
  );
}

function resolveOwner(
  ownerKind: "internal_user" | "participant" | "employer",
  ctx: TransitionEvent["context"],
): ResolvedOwner | null {
  switch (ownerKind) {
    case "participant":
      return ctx.participantId
        ? { ownerParticipantId: ctx.participantId }
        : null;
    case "employer":
      return ctx.employerId ? { ownerEmployerId: ctx.employerId } : null;
    case "internal_user":
      return ctx.consultantId ? { ownerUserId: ctx.consultantId } : null;
  }
}

function hoursFromNow(hours: number): Date {
  return new Date(Date.now() + hours * 3_600_000);
}
