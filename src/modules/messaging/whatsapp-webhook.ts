import { createHmac, timingSafeEqual } from "node:crypto";

// Pure parsing/verification helpers for the Meta WhatsApp Cloud API webhook.
// Kept network- and DB-free so the whole payload → normalized-event mapping and
// the security checks can be unit-tested without credentials or a database.
// Only the fields Meta documents are read; unknown shapes are ignored, never
// fabricated.

/** Delivery lifecycle a status receipt can report (Meta `statuses[].status`). */
export type WhatsAppDeliveryStatus = "sent" | "delivered" | "read" | "failed";

const DELIVERY_STATUSES = new Set<string>([
  "sent",
  "delivered",
  "read",
  "failed",
]);

/** A delivery/read/failed receipt for one previously-sent message. */
export type WhatsAppStatusEvent = {
  kind: "status";
  providerMessageId: string;
  status: WhatsAppDeliveryStatus;
  recipientPhone: string;
  occurredAt: Date;
  // Short human-readable failure reason (Meta `errors[].title`), if any.
  errorTitle: string | null;
};

/** An inbound reply from a contact (reopens the 24h customer-service window). */
export type WhatsAppInboundEvent = {
  kind: "inbound";
  providerMessageId: string;
  fromPhone: string;
  occurredAt: Date;
  // Message text for `type:"text"`; null for media/other unmodelled types.
  text: string | null;
};

export type WhatsAppWebhookEvent = WhatsAppStatusEvent | WhatsAppInboundEvent;

/**
 * The GET verification handshake. Meta calls the webhook with
 * `hub.mode=subscribe`, `hub.verify_token=<the token we configured>` and a
 * `hub.challenge` we must echo back verbatim. Returns the challenge on a match,
 * else null (caller answers 403). An empty expected token means the webhook is
 * unconfigured — never verify in that case.
 */
export function verifyWebhookChallenge(
  query: { mode: string | null; token: string | null; challenge: string | null },
  expectedToken: string,
): string | null {
  if (!expectedToken) return null;
  if (query.mode !== "subscribe") return null;
  if (query.token !== expectedToken) return null;
  return query.challenge ?? null;
}

/**
 * Validate Meta's `X-Hub-Signature-256` header: `sha256=<hex hmac>` of the RAW
 * request body keyed by the app secret. Constant-time compared. Returns false
 * on any malformed input rather than throwing, so a bad signature is simply
 * rejected. An empty app secret means signature checking is not configured.
 */
export function isValidWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string,
): boolean {
  if (!appSecret) return false;
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const provided = signatureHeader.slice("sha256=".length);
  const expected = createHmac("sha256", appSecret)
    .update(rawBody, "utf8")
    .digest("hex");
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

// Meta delivers seconds-since-epoch as a string; guard against junk.
function parseTimestamp(value: unknown): Date {
  const seconds = typeof value === "string" ? Number(value) : Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return new Date();
  return new Date(seconds * 1000);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parseStatus(raw: Record<string, unknown>): WhatsAppStatusEvent | null {
  const providerMessageId = asString(raw.id);
  const status = asString(raw.status);
  const recipientPhone = asString(raw.recipient_id);
  if (!providerMessageId || !status || !recipientPhone) return null;
  if (!DELIVERY_STATUSES.has(status)) return null;
  const errors = Array.isArray(raw.errors) ? raw.errors : [];
  const firstError = errors[0] as Record<string, unknown> | undefined;
  return {
    kind: "status",
    providerMessageId,
    status: status as WhatsAppDeliveryStatus,
    recipientPhone,
    occurredAt: parseTimestamp(raw.timestamp),
    errorTitle: firstError ? asString(firstError.title) : null,
  };
}

function parseInbound(raw: Record<string, unknown>): WhatsAppInboundEvent | null {
  const providerMessageId = asString(raw.id);
  const fromPhone = asString(raw.from);
  if (!providerMessageId || !fromPhone) return null;
  const textNode = raw.text as Record<string, unknown> | undefined;
  return {
    kind: "inbound",
    providerMessageId,
    fromPhone,
    occurredAt: parseTimestamp(raw.timestamp),
    text: textNode ? asString(textNode.body) : null,
  };
}

/**
 * Normalize a raw Meta webhook payload into a flat list of events. The shape is
 * `entry[].changes[].value.{statuses[],messages[]}`; each `statuses` entry maps
 * to a {@link WhatsAppStatusEvent} and each `messages` entry to a
 * {@link WhatsAppInboundEvent}. Malformed or unknown entries are skipped.
 */
export function parseWebhookEvents(payload: unknown): WhatsAppWebhookEvent[] {
  if (!payload || typeof payload !== "object") return [];
  const entries = (payload as Record<string, unknown>).entry;
  if (!Array.isArray(entries)) return [];
  const events: WhatsAppWebhookEvent[] = [];
  for (const entry of entries) {
    const changes = (entry as Record<string, unknown>)?.changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      const value = (change as Record<string, unknown>)?.value;
      if (!value || typeof value !== "object") continue;
      const { statuses, messages } = value as Record<string, unknown>;
      if (Array.isArray(statuses)) {
        for (const raw of statuses) {
          const event = parseStatus(raw as Record<string, unknown>);
          if (event) events.push(event);
        }
      }
      if (Array.isArray(messages)) {
        for (const raw of messages) {
          const event = parseInbound(raw as Record<string, unknown>);
          if (event) events.push(event);
        }
      }
    }
  }
  return events;
}
