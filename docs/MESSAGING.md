# Messaging & the approval-before-send gate

How QCG sends outbound messages (WhatsApp / email), and the **approval gate**
that guarantees no message leaves the system without an explicit human action.

## 1. Channels & adapters

All dispatch goes through a per-channel `ChannelAdapter`
(`src/modules/messaging/adapters.ts`). The adapter is chosen at runtime by
`resolveAdapterMode(channel)`:

| Channel  | Live adapter          | Live requires                                   | Otherwise |
| -------- | --------------------- | ----------------------------------------------- | --------- |
| WhatsApp | `WhatsAppCloudAdapter`| `WHATSAPP_ACCESS_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID` | `MockAdapter` |
| Email    | `ResendEmailAdapter`  | `RESEND_API_KEY` + `RESEND_FROM_EMAIL`          | `MockAdapter` |

- **Mock mode** (no credentials): `MockAdapter.send` only logs a PII-free line
  and returns `{ ok: true }` with **no** `providerMessageId`. Nothing hits the
  network, so demo/dev is always safe.
- **Live WhatsApp**: posts to the Meta Graph API
  (`/{phoneNumberId}/messages`). It sends a free-form `text` message by default,
  or a Meta-approved **HSM template** when `WHATSAPP_USE_TEMPLATES=true` and a
  mapping exists (`whatsapp-templates.ts`). Templates are required for
  business-initiated messages outside the 24h customer-service window.
- **Sender number** (`WHATSAPP_SENDER_NUMBER`, e.g. `4915510151448`): the
  business number this WABA represents. It is shown in the Postausgang so an
  approver can see the sending identity, but it is **informational only** — LIVE
  sends are addressed by `WHATSAPP_PHONE_NUMBER_ID` (Meta's numeric id for that
  number), not by this value.

### Delivery receipts (inbound webhook)

`whatsapp-webhook.ts` parses/verifies Meta's webhook (GET verify-token
handshake + `X-Hub-Signature-256` HMAC). `deliveries.ts` reconciles the events:
a status receipt advances a `message_deliveries` row (matched by
`provider_message_id`), and an inbound reply reopens a participant's 24h window.
The webhook reconciler runs on the trusted OWNER connection (a signed Meta
callback carries no tenant).

## 2. Two ways WhatsApp reaches a recipient

1. **Click-to-chat (`wa.me`) — manual, human-sent.** `click-to-chat.ts`
   (`toWaMeNumber` / `buildWaMeUrl`) + `buildWhatsAppClickToChat` build a
   deep link with the message prefilled; the consultant sends it from **their
   own** WhatsApp. This never dispatches via the API and is **not** gated —
   opening a draft is inherently a human action. It is audited only as
   `whatsapp_click_to_chat_opened` (we can prove it was opened, never delivered).
2. **API dispatch — automated, gated.** Everything that would send via the
   Cloud API now goes through the approval gate below.

## 3. The approval-before-send gate

**Requirement:** no outbound message is dispatched by the system without an
explicit human approval action in the UI.

### Lifecycle

```
pending_approval ──atomic approve/claim──▶ sending ──▶ sent ──(webhook)──▶ delivered
       │                                     └──────────────▶ failed
       ├──reject──▶ rejected
       └──cancel──▶ cancelled
legacy approved ──cancel──▶ cancelled
```

The state machine is pure and unit-tested in
`src/modules/messaging/outbound-status.ts` (`canApprove`, `canReject`,
`canCancel`, `canTransition`, `isTerminal`, `statusForSendResult`).

### The queue: `outbound_messages`

`src/db/schema/outbound-messages.ts` (migration `0012_early_shiva.sql`). Each
row snapshots exactly what will be sent — rendered `body`/`subject`, resolved
recipient (`recipient_phone`/`email`/`name`), `template_key` and the
interpolation `variables` (incl. the magic-link payload) — plus the human
accountability trail: `approved_by_user_id`/`approved_at`,
`rejected_by_user_id`/`rejected_at`/`rejection_reason`, and the post-dispatch
`provider_message_id`/`error_detail`. Tenant-scoped with **RLS**
(`tenant_isolation` policy on `qcg_app`), matching sibling tables.

It is distinct from `message_deliveries`, which tracks post-dispatch provider
delivery receipts. On a successful approval-dispatch the provider id is mirrored
into `message_deliveries` so the webhook reconciler works unchanged.

### Every system send path enqueues instead of sending

`enqueueTaskMessage` (`src/modules/messaging/outbox.ts`) renders the template
and writes **one** `pending_approval` row — it dispatches nothing. All three
system paths now call it:

| Path                                             | Before          | After                     |
| ------------------------------------------------ | --------------- | ------------------------- |
| Routing engine on task creation (`routing/engine.ts`) | dispatched | enqueues pending row |
| Reminder worker (`jobs/worker.ts`)               | auto-dispatched | enqueues pending row (`queued` outcome) |
| Manual internal action (`tasks/actions.ts sendTaskWhatsApp`) | dispatched | enqueues pending row → redirects to `/outbox` |

### Dispatch happens ONLY on approval

`approveAndDispatch` is the single code path that calls an adapter. It loads the
pending row (tenant-scoped), records the approver, transitions
`pending_approval → sending → sent/failed` around the adapter call, mirrors the provider
id into `message_deliveries`, and emits honest audit events. `rejectOutboundMessage`
and `cancelOutboundMessage` never dispatch.

The session-guarded, tenant-scoped server actions live in
`src/modules/outbox/actions.ts` (`approveMessage`, `rejectMessage`,
`cancelMessage`) and are driven from the **Postausgang** UI
(`/outbox`, `src/app/(internal)/outbox/page.tsx`), which lists each pending
message with recipient, channel, and a full body preview plus Approve/Reject
controls.

The `approved` status is retained only so legacy, undispatched rows can be
cancelled. New approvals never persist this intermediate state.

### Ambiguous `sending` recovery

An adapter may reach the provider and then crash before the final database
write. The row deliberately remains `sending`: it must **not** be automatically
retried because the provider may already have accepted the message. After 15
minutes by default (`OUTBOX_STALE_SENDING_MINUTES`), manager/admin users see an
operational warning and a structured `outbox_stale_sending_detected` log.
Recovery requires manual reconciliation against provider records/webhooks,
followed by a forward status correction based on evidence.

### Audit events

`message_queued` (created), `message_approved`, `message_dispatched` /
`message_dispatch_failed`, `message_rejected`, `message_cancelled`, and the
manual `whatsapp_manual_queued`. All meta is PII-minimal (ids, channel,
template key, recipient kind).

## 4. Configuration

Set in `.env.local` (see `src/lib/env.ts`):

- `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` — enable live WhatsApp.
- `WHATSAPP_API_VERSION` (default `v21.0`), `WHATSAPP_USE_TEMPLATES`,
  `WHATSAPP_TEMPLATE_LANGUAGE` (default `de`).
- `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET` — inbound webhook.
- `RESEND_API_KEY`, `RESEND_FROM_EMAIL` — enable live email.

Without WhatsApp/email credentials the app stays in mock mode: approving a
pending message "sends" via the MockAdapter (logs only, no network, no
`message_deliveries` row).
