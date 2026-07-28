import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { channel, outboundMessageStatus, ownerKind } from "./enums";
import { createdAt, tenantId, updatedAt } from "./helpers";
import { tasks } from "./tasks";
import { users } from "./users";

// The approval-before-send queue ("Postausgang"). Every system-initiated
// outbound message (routing engine on task creation, the reminder worker, and
// the manual internal "send" action) writes ONE pending row here instead of
// dispatching. Nothing reaches the WhatsApp/email provider until a signed-in
// user explicitly approves the row — the approve action performs the actual
// adapter dispatch and records the provider message id + receipts.
//
// The row snapshots exactly what will be sent (rendered body/subject, resolved
// recipient, template key, and the interpolation variables incl. the magic-link
// payload) so the approver previews the real message, and so a later approval
// dispatches deterministically without re-rendering. Distinct from
// message_deliveries, which tracks the post-dispatch provider delivery receipts.
export const outboundMessages = pgTable(
  "outbound_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    // The task whose message this is (nullable: ad-hoc sends without a task).
    taskId: uuid("task_id").references(() => tasks.id),
    channel: channel("channel").notNull().default("whatsapp"),
    templateKey: text("template_key").notNull(),
    recipientKind: ownerKind("recipient_kind").notNull(),
    recipientId: uuid("recipient_id").notNull(),
    // Resolved address(es) + display name snapshotted for preview + dispatch.
    recipientPhone: text("recipient_phone"),
    recipientEmail: text("recipient_email"),
    recipientName: text("recipient_name"),
    // Rendered, ready-to-send content the approver previews verbatim.
    subject: text("subject"),
    body: text("body").notNull(),
    // Interpolation variables (firstName, title, link, …) incl. the magic-link
    // payload — carried so the WhatsApp adapter can fill an HSM template's
    // ordered params at dispatch time.
    variables: jsonb("variables").$type<Record<string, string>>(),
    status: outboundMessageStatus("status").notNull().default("pending_approval"),
    // Null denotes a system-generated message. Manual Cloud API drafts record
    // their creator so separation of duties can be enforced at approval time.
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    // Who approved/rejected and when — the human accountability trail.
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    rejectedByUserId: uuid("rejected_by_user_id").references(() => users.id),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    rejectionReason: text("rejection_reason"),
    // Provider-assigned id after a successful dispatch (Meta `messages[0].id`),
    // mirrored into message_deliveries so a webhook receipt can reconcile it.
    providerMessageId: text("provider_message_id"),
    // Short failure reason from a failed dispatch attempt.
    errorDetail: text("error_detail"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // Backs the Postausgang list (pending rows per tenant, newest first).
    index("outbound_messages_status_idx").on(t.tenantId, t.status),
    index("outbound_messages_task_idx").on(t.tenantId, t.taskId),
    index("outbound_messages_creator_idx").on(t.tenantId, t.createdByUserId),
  ],
);
