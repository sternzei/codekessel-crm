import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { channel, ownerKind } from "./enums";
import { createdAt, tenantId, updatedAt } from "./helpers";
import { tasks } from "./tasks";

// One row per outbound provider-addressed message that carries a provider
// message id (today: WhatsApp Cloud API). It is the seam that lets an inbound
// webhook receipt reconcile delivery state: the send records the id here, and a
// later delivery/read/failed receipt looks the row up by provider_message_id
// and advances its status + stamps the matching timestamp.
//
// The MockAdapter never yields a provider id, so nothing is written in demo
// mode — this table only fills up once real WhatsApp credentials are present.
export const messageDeliveries = pgTable(
  "message_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    // The task whose message this delivery belongs to (nullable: ad-hoc sends).
    taskId: uuid("task_id").references(() => tasks.id),
    channel: channel("channel").notNull().default("whatsapp"),
    // Provider-assigned id (Meta `messages[0].id`, e.g. "wamid...."). Globally
    // unique across WABAs, so the webhook can resolve the row without a tenant.
    providerMessageId: text("provider_message_id").notNull(),
    recipientKind: ownerKind("recipient_kind").notNull(),
    recipientId: uuid("recipient_id").notNull(),
    // Lifecycle: sent | delivered | read | failed (see delivery-status.ts). Kept
    // as text (not an enum) since the values live in one pure module and never
    // fan out to other tables.
    status: text("status").notNull().default("sent"),
    // Short failure reason from a failed receipt (Meta `errors[].title`).
    errorDetail: text("error_detail"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    readAt: timestamp("read_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("message_deliveries_provider_msg_idx").on(t.providerMessageId),
    index("message_deliveries_task_idx").on(t.tenantId, t.taskId),
  ],
);
