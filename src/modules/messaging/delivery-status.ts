import type { WhatsAppDeliveryStatus } from "./whatsapp-webhook";

// Pure state-transition logic for a message_deliveries row. Kept DB- and
// network-free so the monotonic status merge and the column projection can be
// unit-tested without a database.

// How far along the lifecycle each status is. A receipt only ever advances the
// stored status; a lower-ranked receipt (e.g. a `delivered` that arrives after a
// `read`) never regresses it. `failed` outranks `sent` only — a message already
// delivered/read is never downgraded to failed by a late/duplicate receipt.
const STATUS_RANK: Record<WhatsAppDeliveryStatus, number> = {
  sent: 0,
  failed: 1,
  delivered: 2,
  read: 3,
};

/** The more-advanced of two statuses (monotonic forward progress). */
export function mergeDeliveryStatus(
  current: WhatsAppDeliveryStatus,
  incoming: WhatsAppDeliveryStatus,
): WhatsAppDeliveryStatus {
  return STATUS_RANK[incoming] > STATUS_RANK[current] ? incoming : current;
}

const TIMESTAMP_COLUMN: Record<
  WhatsAppDeliveryStatus,
  "sentAt" | "deliveredAt" | "readAt" | "failedAt"
> = {
  sent: "sentAt",
  delivered: "deliveredAt",
  read: "readAt",
  failed: "failedAt",
};

/** The row column that a receipt of this status stamps. */
export function timestampColumnFor(
  status: WhatsAppDeliveryStatus,
): "sentAt" | "deliveredAt" | "readAt" | "failedAt" {
  return TIMESTAMP_COLUMN[status];
}

export type DeliveryReceiptUpdate = {
  status: WhatsAppDeliveryStatus;
  sentAt?: Date;
  deliveredAt?: Date;
  readAt?: Date;
  failedAt?: Date;
  errorDetail?: string | null;
};

/**
 * Build the partial column update for a status receipt: the merged status, the
 * incoming status's own timestamp (always stamped, even out of order, so each
 * milestone is recorded), and the failure detail on a `failed` receipt.
 */
export function buildDeliveryReceiptUpdate(
  currentStatus: WhatsAppDeliveryStatus,
  incoming: {
    status: WhatsAppDeliveryStatus;
    occurredAt: Date;
    errorTitle?: string | null;
  },
): DeliveryReceiptUpdate {
  const update: DeliveryReceiptUpdate = {
    status: mergeDeliveryStatus(currentStatus, incoming.status),
    [timestampColumnFor(incoming.status)]: incoming.occurredAt,
  };
  if (incoming.status === "failed") {
    update.errorDetail = incoming.errorTitle ?? null;
  }
  return update;
}

// Meta's customer-service window is 24h from the contact's last inbound message.
const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;

/** When the 24h free-form reply window closes given an inbound message time. */
export function computeSessionWindowExpiry(inboundAt: Date): Date {
  return new Date(inboundAt.getTime() + SESSION_WINDOW_MS);
}
