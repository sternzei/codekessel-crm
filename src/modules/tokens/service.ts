import { createHash } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { DbHandle } from "@/db/client";
import { magicLinkTokens, reminderJobs, tasks } from "@/db/schema";
import { env } from "@/lib/env";
import { logActivity } from "@/modules/audit/log";
import { isActiveTaskStatus } from "@/modules/tasks/status";
import { computeTokenExpiry, resolveTokenTtlHours } from "./policy";

// Magic links are the only way external people touch the system: one link,
// one task, no account. The JWT carries just enough to route validation
// (tenant + row id); authorization lives in the DB row, which gives us
// revocation, single-use enforcement, and an audit trail.

const secret = new TextEncoder().encode(env.TOKEN_SECRET);

export type SubjectKind = "participant" | "employer";

export type IssueParams = {
  tenantId: string;
  taskId: string;
  subjectKind: SubjectKind;
  subjectId: string;
  scope: string;
  ttlHours?: number;
};

export async function issueMagicLink(
  tx: DbHandle,
  params: IssueParams,
): Promise<{ url: string; tokenId: string; expiresAt: Date }> {
  // TTL/expiry is centralised in the policy module: an explicit per-issue value
  // wins, else the deployment default (MAGIC_LINK_TTL_HOURS), else the built-in
  // default — always clamped to safe guardrails.
  const ttlHours = resolveTokenTtlHours({
    requestedTtlHours: params.ttlHours,
    configuredTtlHours: env.MAGIC_LINK_TTL_HOURS,
  });
  const expiresAt = computeTokenExpiry(ttlHours);

  const token = await new SignJWT({
    tid: params.tenantId,
    scope: params.scope,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(params.subjectId)
    .setJti(crypto.randomUUID())
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(secret);

  const [row] = await tx
    .insert(magicLinkTokens)
    .values({
      tenantId: params.tenantId,
      taskId: params.taskId,
      subjectKind: params.subjectKind,
      subjectId: params.subjectId,
      scope: params.scope,
      tokenHash: sha256(token),
      expiresAt,
    })
    .returning({ id: magicLinkTokens.id });

  return {
    url: `${env.APP_BASE_URL}/t/${token}`,
    tokenId: row.id,
    expiresAt,
  };
}

export type TokenValidation =
  | { ok: true; tenantId: string; tokenRow: TokenRow; task: TaskRow }
  | {
      ok: false;
      reason: "invalid" | "expired" | "used" | "revoked" | "task_closed";
    };

type TokenRow = typeof magicLinkTokens.$inferSelect;
type TaskRow = typeof tasks.$inferSelect;

// Scopes whose links are intentionally multi-use, so the "task closed" gate in
// loadTokenContext does NOT apply to them (re-entry is a deliberate drop-off
// reduction feature, not a bug):
//  * start_aptitude_test — the participant may re-open the link until they
//    actually finish the test (the scope only ever *starts* it).
//  * the employer setup wizard scopes — valid across visits until the employer
//    is confirmed; the token is burned only when the setup completes (mirrors
//    EMPLOYER_SCOPES in modules/employers/actions.ts).
const MULTI_USE_SCOPES = new Set<string>([
  "start_aptitude_test",
  "provide_betriebsnummer",
  "confirm_ags_status",
  "confirm_time_model",
  "employer_setup",
]);

/** True when a token stays usable even after its task leaves the active set. */
export function isMultiUseScope(scope: string): boolean {
  return MULTI_USE_SCOPES.has(scope);
}

/**
 * Stage 1 (stateless): verify signature + expiry, extract tenant id.
 * Stage 2 (stateful, caller provides tenant-scoped tx): match the stored
 * hash and check used/revoked. Split because the tenant id needed to open
 * the RLS transaction comes out of stage 1.
 */
export async function verifyTokenSignature(
  token: string,
): Promise<{ tenantId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    if (typeof payload.tid !== "string") return null;
    return { tenantId: payload.tid };
  } catch {
    return null;
  }
}

export async function loadTokenContext(
  tx: DbHandle,
  token: string,
): Promise<TokenValidation> {
  const tenant = await verifyTokenSignature(token);
  if (!tenant) return { ok: false, reason: "invalid" };

  const [row] = await tx
    .select()
    .from(magicLinkTokens)
    .where(eq(magicLinkTokens.tokenHash, sha256(token)));
  if (!row) return { ok: false, reason: "invalid" };
  if (row.revokedAt) return { ok: false, reason: "revoked" };
  if (row.usedAt) return { ok: false, reason: "used" };
  if (row.expiresAt < new Date()) return { ok: false, reason: "expired" };

  const [task] = await tx.select().from(tasks).where(eq(tasks.id, row.taskId));
  if (!task) return { ok: false, reason: "invalid" };

  // F1: a link is dead once its task is no longer active (done/escalated/
  // cancelled), so a stale link can't drive a second mutation. The intentional
  // multi-use scopes are exempt — their tasks stay active until completion and
  // re-entry is a feature (see MULTI_USE_SCOPES).
  if (!isActiveTaskStatus(task.status) && !isMultiUseScope(row.scope)) {
    return { ok: false, reason: "task_closed" };
  }

  return { ok: true, tenantId: tenant.tenantId, tokenRow: row, task };
}

/**
 * Supersede helper: revoke every still-live (unused, not-yet-revoked) token for
 * a task so at most one credential is ever valid at a time. A token already
 * burned (used_at set) or revoked is left untouched — including, when called
 * right after a burn, the token that just won the race.
 */
export async function revokeUnusedTokensForTask(
  tx: DbHandle,
  taskId: string,
): Promise<void> {
  await tx
    .update(magicLinkTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(magicLinkTokens.taskId, taskId),
        isNull(magicLinkTokens.usedAt),
        isNull(magicLinkTokens.revokedAt),
      ),
    );
}

/**
 * Proactively cancel a task's still-scheduled reminder jobs, so a completed
 * task stops nagging immediately instead of waiting for the next worker poll.
 * Mirrors the cancel pattern in participants/actions-internal.ts.
 */
export async function cancelScheduledRemindersForTask(
  tx: DbHandle,
  taskId: string,
): Promise<void> {
  await tx
    .update(reminderJobs)
    .set({ status: "cancelled" })
    .where(
      and(eq(reminderJobs.taskId, taskId), eq(reminderJobs.status, "scheduled")),
    );
}

/**
 * Single-use burn. F2: the update is atomic — only the transaction that flips
 * used_at from NULL "wins" (WHERE used_at IS NULL ... RETURNING). A concurrent
 * double-submit (the user double-taps the button) finds no row to burn and this
 * returns false, so the caller performs no further side effects.
 * @returns true when THIS call burned the token, false when it was already used.
 */
export async function markTokenUsed(
  tx: DbHandle,
  tokenRow: TokenRow,
): Promise<boolean> {
  const burned = await tx
    .update(magicLinkTokens)
    .set({ usedAt: new Date() })
    .where(
      and(eq(magicLinkTokens.id, tokenRow.id), isNull(magicLinkTokens.usedAt)),
    )
    .returning({ id: magicLinkTokens.id });
  if (burned.length === 0) return false;

  await logActivity(tx, {
    tenantId: tokenRow.tenantId,
    actorKind: tokenRow.subjectKind,
    subjectKind: "task",
    subjectId: tokenRow.taskId,
    event: "token_used",
    meta: { scope: tokenRow.scope },
  });
  return true;
}

/**
 * Standard completion for an external task: token burned first (the atomic
 * gate), then task → done + audit entry. Every magic-link action ends here
 * (except multi-visit flows like the employer wizard, which burn the token
 * only when complete). Burning first means a concurrent double-submit closes
 * the task and logs completion exactly once.
 * @returns true when this call completed the task, false on a lost race.
 */
export async function completeTaskViaToken(
  tx: DbHandle,
  ctx: { tokenRow: TokenRow; task: TaskRow },
): Promise<boolean> {
  const burned = await markTokenUsed(tx, ctx.tokenRow);
  if (!burned) return false;

  await tx
    .update(tasks)
    .set({ status: "done", completedAt: new Date() })
    .where(eq(tasks.id, ctx.task.id));

  await logActivity(tx, {
    tenantId: ctx.tokenRow.tenantId,
    actorKind: ctx.tokenRow.subjectKind,
    subjectKind: "task",
    subjectId: ctx.task.id,
    event: "task_completed",
    meta: { taskType: ctx.task.type },
  });

  // P2: once the task is done there must be no other live credential and no
  // pending reminders. Revoke any sibling tokens (the just-burned one is
  // excluded — it now has used_at) and cancel scheduled reminders.
  await revokeUnusedTokensForTask(tx, ctx.task.id);
  await cancelScheduledRemindersForTask(tx, ctx.task.id);
  return true;
}

/**
 * Returns a usable /t/{jwt} magic-link URL for an external task, or null when
 * the task has no external link semantics (internal owner / no subject).
 *
 * F3/F4: the raw JWT is never persisted (only its SHA-256 hash), so a lost or
 * reminder-triggered link can't be "reconstructed" — we mint a fresh one. To
 * keep single-use hygiene we first supersede (revoke) any still-live token for
 * the same task, so at most one credential is ever valid at a time.
 */
export async function getOrIssueMagicLinkForTask(
  tx: DbHandle,
  task: TaskRow,
): Promise<string | null> {
  if (task.ownerKind === "internal_user") return null;
  const subjectKind: SubjectKind = task.ownerKind;
  const subjectId =
    task.ownerKind === "participant"
      ? task.ownerParticipantId
      : task.ownerEmployerId;
  if (!subjectId) return null;

  await revokeUnusedTokensForTask(tx, task.id);

  const link = await issueMagicLink(tx, {
    tenantId: task.tenantId,
    taskId: task.id,
    subjectKind,
    subjectId,
    scope: task.type,
  });
  return link.url;
}

export async function revokeToken(
  tx: DbHandle,
  tokenId: string,
): Promise<void> {
  await tx
    .update(magicLinkTokens)
    .set({ revokedAt: new Date() })
    .where(eq(magicLinkTokens.id, tokenId));
}

/**
 * Ids of a task's still-live credentials: unused, not revoked, not expired.
 * Used by the consultant-facing manual revoke so each token is revoked (via
 * revokeToken) and audited individually — this mirrors the bulk supersede
 * revokeUnusedTokensForTask that runs automatically on task completion.
 */
export async function listLiveTokenIdsForTask(
  tx: DbHandle,
  taskId: string,
): Promise<string[]> {
  const rows = await tx
    .select({ id: magicLinkTokens.id })
    .from(magicLinkTokens)
    .where(
      and(
        eq(magicLinkTokens.taskId, taskId),
        isNull(magicLinkTokens.usedAt),
        isNull(magicLinkTokens.revokedAt),
        gt(magicLinkTokens.expiresAt, new Date()),
      ),
    );
  return rows.map((row) => row.id);
}

export type TaskLinkState = {
  /** A usable link exists (unused, not revoked, not expired). */
  hasLiveLink: boolean;
  /** How many of the task's links were explicitly revoked/superseded. */
  revokedLinkCount: number;
};

/**
 * Snapshot of a task's magic-link credential state for internal surfacing:
 * whether a live link exists and how many have been revoked/superseded. Lets a
 * consultant see at a glance that a link was invalidated.
 */
export async function getTaskLinkState(
  tx: DbHandle,
  taskId: string,
): Promise<TaskLinkState> {
  const [row] = await tx
    .select({
      hasLiveLink: sql<boolean>`bool_or(
        ${magicLinkTokens.usedAt} is null
        and ${magicLinkTokens.revokedAt} is null
        and ${magicLinkTokens.expiresAt} > now()
      )`,
      revokedLinkCount: sql<number>`count(*) filter (
        where ${magicLinkTokens.revokedAt} is not null
      )::int`,
    })
    .from(magicLinkTokens)
    .where(eq(magicLinkTokens.taskId, taskId));
  return {
    hasLiveLink: row?.hasLiveLink ?? false,
    revokedLinkCount: row?.revokedLinkCount ?? 0,
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
