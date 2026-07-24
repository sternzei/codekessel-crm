import { eq } from "drizzle-orm";
import type { DbHandle } from "@/db/client";
import { messageDeliveries, participants } from "@/db/schema";
import { normalizePhone } from "@/modules/participants/phone";
import {
  buildDeliveryReceiptUpdate,
  computeSessionWindowExpiry,
} from "./delivery-status";
import type {
  WhatsAppInboundEvent,
  WhatsAppStatusEvent,
  WhatsAppWebhookEvent,
} from "./whatsapp-webhook";
import type { MessageChannel, Recipient } from "./types";

export type RecordDeliveryParams = {
  tenantId: string;
  taskId?: string;
  channel: MessageChannel;
  providerMessageId: string;
  recipient: Recipient;
};

/**
 * Persist the provider message id of a just-sent message so a later webhook
 * receipt can reconcile its delivery state. No-op unless a provider id exists
 * (the demo MockAdapter never returns one, so nothing is written in demo mode).
 */
export async function recordOutboundDelivery(
  tx: DbHandle,
  params: RecordDeliveryParams,
): Promise<void> {
  await tx.insert(messageDeliveries).values({
    tenantId: params.tenantId,
    taskId: params.taskId,
    channel: params.channel,
    providerMessageId: params.providerMessageId,
    recipientKind: params.recipient.kind,
    recipientId: params.recipient.id,
    status: "sent",
    sentAt: new Date(),
  });
}

/**
 * Apply one delivery/read/failed receipt: find the delivery by its provider
 * message id and advance its status monotonically + stamp the matching
 * timestamp. Unknown ids are ignored (a receipt for a message we never recorded,
 * e.g. sent before this table existed).
 */
export async function applyStatusReceipt(
  db: DbHandle,
  event: WhatsAppStatusEvent,
): Promise<boolean> {
  const [row] = await db
    .select({
      id: messageDeliveries.id,
      status: messageDeliveries.status,
    })
    .from(messageDeliveries)
    .where(eq(messageDeliveries.providerMessageId, event.providerMessageId));
  if (!row) return false;

  const update = buildDeliveryReceiptUpdate(
    row.status as WhatsAppStatusEvent["status"],
    event,
  );
  await db
    .update(messageDeliveries)
    .set({ ...update, updatedAt: new Date() })
    .where(eq(messageDeliveries.id, row.id));
  return true;
}

/**
 * Apply one inbound reply: reopen the participant's 24h WhatsApp session window
 * (matched by normalized phone). Employers have no WhatsApp consent/window model
 * in this app, so only participants are reopened. Unknown numbers are ignored.
 */
export async function applyInboundReceipt(
  db: DbHandle,
  event: WhatsAppInboundEvent,
): Promise<boolean> {
  const normalized = normalizePhone({ raw: event.fromPhone }).normalized;
  if (!normalized) return false;
  const updated = await db
    .update(participants)
    .set({ whatsappWindowExpiresAt: computeSessionWindowExpiry(event.occurredAt) })
    .where(eq(participants.phoneNormalized, normalized))
    .returning({ id: participants.id });
  return updated.length > 0;
}

/**
 * Reconcile a batch of parsed webhook events against stored delivery state.
 * Runs on a trusted system connection (a signed Meta callback has no tenant).
 */
export async function reconcileDeliveryEvents(
  db: DbHandle,
  events: WhatsAppWebhookEvent[],
): Promise<{ statusApplied: number; inboundApplied: number }> {
  let statusApplied = 0;
  let inboundApplied = 0;
  for (const event of events) {
    if (event.kind === "status") {
      if (await applyStatusReceipt(db, event)) statusApplied += 1;
    } else if (await applyInboundReceipt(db, event)) {
      inboundApplied += 1;
    }
  }
  return { statusApplied, inboundApplied };
}
