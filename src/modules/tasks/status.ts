// Single definition of "an active task" — a task still worth acting on
// (routing idempotency, reminder relevance, magic-link validity). Kept in one
// place so the routing engine, the reminder worker, and the magic-link token
// service can never drift apart on what counts as open.

export const ACTIVE_TASK_STATUSES = ["open", "in_progress", "waiting"] as const;

export type ActiveTaskStatus = (typeof ACTIVE_TASK_STATUSES)[number];

/** True when a task is still open (∈ {open, in_progress, waiting}). */
export function isActiveTaskStatus(status: string): boolean {
  return (ACTIVE_TASK_STATUSES as readonly string[]).includes(status);
}
