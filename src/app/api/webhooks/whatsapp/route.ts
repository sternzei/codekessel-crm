import { getSystemDb } from "@/db/system-client";
import { logger } from "@/lib/logger";
import { reconcileDeliveryEvents } from "@/modules/messaging/deliveries";
import {
  isValidWebhookSignature,
  parseWebhookEvents,
  verifyWebhookChallenge,
} from "@/modules/messaging/whatsapp-webhook";

// Meta WhatsApp Cloud API webhook (§0d step 3 / F.4). Two entry points:
//  * GET  — the one-time verify-token handshake Meta runs when the webhook URL
//           is subscribed.
//  * POST — delivery/read/failed receipts and inbound replies.
//
// DEMO-SAFE: both handlers are inert until the client provisions the WABA and
// sets WHATSAPP_WEBHOOK_VERIFY_TOKEN (handshake) + WHATSAPP_APP_SECRET
// (signature check). Without those the route makes no state changes and never
// trusts an unsigned body, so it is safe to deploy before credentials exist.
// A validly-signed POST reconciles delivery/read/failed receipts against the
// message_deliveries table and reopens the 24h session window on inbound
// replies, via the trusted owner connection (a Meta callback carries no tenant).

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const expectedToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? "";
  // Unconfigured → behave as if the route does not exist (no info leak).
  if (!expectedToken) return new Response("Not found", { status: 404 });

  const url = new URL(request.url);
  const challenge = verifyWebhookChallenge(
    {
      mode: url.searchParams.get("hub.mode"),
      token: url.searchParams.get("hub.verify_token"),
      challenge: url.searchParams.get("hub.challenge"),
    },
    expectedToken,
  );
  if (challenge === null) return new Response("Forbidden", { status: 403 });
  // Meta expects the raw challenge echoed back as text/plain.
  return new Response(challenge, {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  });
}

export async function POST(request: Request): Promise<Response> {
  const appSecret = process.env.WHATSAPP_APP_SECRET ?? "";
  // Unconfigured → acknowledge so Meta stops retrying, but do nothing. Never
  // process an unsigned body.
  if (!appSecret) return new Response("ok", { status: 200 });

  // The signature covers the RAW bytes, so read the body as text first.
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");
  if (!isValidWebhookSignature(rawBody, signature, appSecret)) {
    return new Response("Invalid signature", { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  const events = parseWebhookEvents(payload);
  const statusCount = events.filter((e) => e.kind === "status").length;
  const inboundCount = events.filter((e) => e.kind === "inbound").length;

  // Reconcile against stored delivery state on the trusted owner connection.
  // If MIGRATION_DATABASE_URL is unset there is no system db to write to; we
  // still 200 (the signature was valid) so Meta does not retry.
  const systemDb = getSystemDb();
  if (systemDb) {
    try {
      const applied = await reconcileDeliveryEvents(systemDb, events);
      logger.info("whatsapp webhook reconciled", {
        statusCount,
        inboundCount,
        ...applied,
      });
    } catch (error: unknown) {
      logger.error("whatsapp webhook reconcile failed", {
        message: error instanceof Error ? error.message : "unknown",
      });
    }
  } else {
    logger.info("whatsapp webhook received", { statusCount, inboundCount });
  }

  // Always 200 so Meta does not retry a payload we have already accepted.
  return new Response("ok", { status: 200 });
}
