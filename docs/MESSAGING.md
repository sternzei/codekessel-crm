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

**Status (2026-07-30):** Meta Cloud API setup is **parked**. Until
`WHATSAPP_ACCESS_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID` are set, the product uses
the interim path below and never reports a mock Cloud send as “versendet”.

1. **Click-to-chat (`wa.me`) — interim primary.** Tasks UI shows
   **WhatsApp öffnen** when Cloud API is not live. Opens a prefilled draft on
   the consultant’s own WhatsApp via `buildWhatsAppClickToChat`. Manual send on
   the device.
2. **API dispatch — business number (future / when LIVE).** Uses
   `WHATSAPP_SENDER_NUMBER` / Cloud API. Immediate dispatch when credentials
   exist:
   - Manual task action (`sendTaskWhatsApp` / **WhatsApp senden**)
   - Routing follow-ups + reminder worker (`enqueueAndDispatchOnHandle`)
   Without credentials, `sendTaskWhatsApp` redirects with `wa=cloud_unavailable`
   instead of faking success.

## 3. The approval-before-send gate

**Requirement:** no *automated* outbound message is dispatched without an
explicit human approval action in the UI. A consultant clicking
**WhatsApp senden** on a task counts as that action.

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

### Workflow sends dispatch immediately

| Path | Behaviour |
| ---- | --------- |
| Routing engine (`routing/engine.ts` → `dispatchExternal`) | `enqueueAndDispatchOnHandle` — immediate send |
| Reminder worker (`jobs/worker.ts`) | `enqueueAndDispatchOnHandle` — immediate send |
| Manual internal action (`tasks/actions.ts sendTaskWhatsApp`) | `enqueueAndDispatchManual` — immediate send |

`enqueueTaskMessage` (pending_approval only) remains for any caller that still
wants a review queue; workflow paths no longer use it.

### Dispatch paths

- `enqueueAndDispatchOnHandle` / `enqueueAndDispatchManual` — primary send paths.
- `approveAndDispatch` — Postausgang approval for any remaining pending rows
  (manager/admin, no self-approval).

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

`message_queued` (system enqueue), `message_approved`, `message_dispatched` /
`message_dispatch_failed`, `message_rejected`, `message_cancelled`, and the
manual `whatsapp_manual_sent` / `whatsapp_manual_failed`. All meta is
PII-minimal (ids, channel, template key, recipient kind).

## 4. Configuration

Set in `.env.local` (validated in `src/lib/env.ts`):

- `RESEND_API_KEY`, `RESEND_FROM_EMAIL` — enable **live email** (both required).
  Resend `fetch` uses a 15s `AbortController` timeout so a hung provider cannot
  stall the outbox worker.
- `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` — enable live WhatsApp
  Cloud (**parked** until Meta setup). Until then the tasks UI uses
  **WhatsApp öffnen** (wa.me click-to-chat) and never claims Cloud “versendet”.
- `WHATSAPP_API_VERSION` (default `v21.0`), `WHATSAPP_USE_TEMPLATES`,
  `WHATSAPP_TEMPLATE_LANGUAGE` (default `de`).
- `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET` — inbound webhook.

Without email credentials the email adapter stays mock. Without WhatsApp
credentials Cloud stays mock; consultants still open WhatsApp via wa.me.
