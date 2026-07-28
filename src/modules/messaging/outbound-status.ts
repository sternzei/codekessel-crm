// Pure state machine for the approval-before-send outbound-message lifecycle.
// Network- and DB-free so every transition rule can be unit-tested in isolation
// and reused by both the server actions and the dispatch path. The DB column is
// `outbound_message_status` (see schema/enums.ts) — these values must match it.

export type OutboundMessageStatus =
  | "pending_approval"
  | "approved"
  | "sending"
  | "sent"
  | "delivered"
  | "failed"
  | "rejected"
  | "cancelled";

// Allowed forward transitions. A signed-in user drives approve/reject/cancel;
// the dispatch path drives approved→sending→sent/failed; a webhook receipt
// later advances sent→delivered (reconciled via message_deliveries).
const TRANSITIONS: Readonly<Record<OutboundMessageStatus, readonly OutboundMessageStatus[]>> = {
  pending_approval: ["approved", "rejected", "cancelled"],
  approved: ["sending", "cancelled"],
  sending: ["sent", "failed"],
  sent: ["delivered"],
  delivered: [],
  failed: [],
  rejected: [],
  cancelled: [],
};

// Statuses from which no further transition is possible.
const TERMINAL_STATUSES: ReadonlySet<OutboundMessageStatus> = new Set([
  "delivered",
  "failed",
  "rejected",
  "cancelled",
]);

/** Whether a direct transition from → to is permitted by the state machine. */
export function canTransition(
  from: OutboundMessageStatus,
  to: OutboundMessageStatus,
): boolean {
  return TRANSITIONS[from].includes(to);
}

/** A message still awaiting a human decision can be approved. */
export function canApprove(status: OutboundMessageStatus): boolean {
  return status === "pending_approval";
}

/** A message still awaiting a human decision can be rejected. */
export function canReject(status: OutboundMessageStatus): boolean {
  return status === "pending_approval";
}

/** Pending or approved-but-not-yet-dispatched messages can be cancelled. */
export function canCancel(status: OutboundMessageStatus): boolean {
  return status === "pending_approval" || status === "approved";
}

/** No further transition is possible from a terminal status. */
export function isTerminal(status: OutboundMessageStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/**
 * Map an adapter send result to the next status. A successful dispatch lands in
 * `sent` (a later webhook receipt may advance it to `delivered`); a failure
 * lands in `failed`.
 */
export function statusForSendResult(ok: boolean): OutboundMessageStatus {
  return ok ? "sent" : "failed";
}
