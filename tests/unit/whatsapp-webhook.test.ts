import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  isValidWebhookSignature,
  parseWebhookEvents,
  verifyWebhookChallenge,
} from "@/modules/messaging/whatsapp-webhook";

// --- GET verify-token handshake --------------------------------------------

test("verifyWebhookChallenge echoes the challenge only on a full match", () => {
  assert.equal(
    verifyWebhookChallenge(
      { mode: "subscribe", token: "secret", challenge: "1234" },
      "secret",
    ),
    "1234",
  );
});

test("verifyWebhookChallenge refuses a wrong token, wrong mode, or empty expected", () => {
  assert.equal(
    verifyWebhookChallenge(
      { mode: "subscribe", token: "nope", challenge: "1234" },
      "secret",
    ),
    null,
  );
  assert.equal(
    verifyWebhookChallenge(
      { mode: "unsubscribe", token: "secret", challenge: "1234" },
      "secret",
    ),
    null,
  );
  // An unconfigured webhook (empty expected token) never verifies.
  assert.equal(
    verifyWebhookChallenge(
      { mode: "subscribe", token: "", challenge: "1234" },
      "",
    ),
    null,
  );
});

// --- POST signature validation ---------------------------------------------

function sign(body: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
}

test("isValidWebhookSignature accepts a correct HMAC over the raw body", () => {
  const body = '{"object":"whatsapp_business_account"}';
  assert.equal(isValidWebhookSignature(body, sign(body, "app-secret"), "app-secret"), true);
});

test("isValidWebhookSignature rejects tampered body, wrong secret, and malformed header", () => {
  const body = '{"a":1}';
  const good = sign(body, "app-secret");
  assert.equal(isValidWebhookSignature('{"a":2}', good, "app-secret"), false);
  assert.equal(isValidWebhookSignature(body, sign(body, "other"), "app-secret"), false);
  assert.equal(isValidWebhookSignature(body, "deadbeef", "app-secret"), false);
  assert.equal(isValidWebhookSignature(body, null, "app-secret"), false);
  // Unconfigured (empty secret) never validates.
  assert.equal(isValidWebhookSignature(body, good, ""), false);
});

// --- Payload → normalized events -------------------------------------------

test("parseWebhookEvents maps a delivery status receipt", () => {
  const payload = {
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            value: {
              statuses: [
                {
                  id: "wamid.ABC",
                  status: "delivered",
                  timestamp: "1700000000",
                  recipient_id: "491511234567",
                },
              ],
            },
          },
        ],
      },
    ],
  };
  const events = parseWebhookEvents(payload);
  assert.equal(events.length, 1);
  const [event] = events;
  assert.equal(event.kind, "status");
  assert.equal(event.kind === "status" && event.providerMessageId, "wamid.ABC");
  assert.equal(event.kind === "status" && event.status, "delivered");
  assert.equal(event.kind === "status" && event.recipientPhone, "491511234567");
  assert.deepEqual(
    event.kind === "status" && event.occurredAt,
    new Date(1700000000 * 1000),
  );
});

test("parseWebhookEvents captures a failed receipt's error title", () => {
  const [event] = parseWebhookEvents({
    entry: [
      {
        changes: [
          {
            value: {
              statuses: [
                {
                  id: "wamid.X",
                  status: "failed",
                  timestamp: "1700000000",
                  recipient_id: "49150",
                  errors: [{ code: 131047, title: "Re-engagement message" }],
                },
              ],
            },
          },
        ],
      },
    ],
  });
  assert.equal(event.kind === "status" && event.status, "failed");
  assert.equal(event.kind === "status" && event.errorTitle, "Re-engagement message");
});

test("parseWebhookEvents maps an inbound text reply", () => {
  const [event] = parseWebhookEvents({
    entry: [
      {
        changes: [
          {
            value: {
              messages: [
                {
                  id: "wamid.IN",
                  from: "491511234567",
                  timestamp: "1700000100",
                  type: "text",
                  text: { body: "Ja, passt!" },
                },
              ],
            },
          },
        ],
      },
    ],
  });
  assert.equal(event.kind, "inbound");
  assert.equal(event.kind === "inbound" && event.fromPhone, "491511234567");
  assert.equal(event.kind === "inbound" && event.text, "Ja, passt!");
});

test("parseWebhookEvents skips unknown/invalid statuses and shapes", () => {
  // Unknown status value dropped; a status missing ids dropped.
  const events = parseWebhookEvents({
    entry: [
      {
        changes: [
          {
            value: {
              statuses: [
                { id: "wamid.Y", status: "queued", timestamp: "1", recipient_id: "1" },
                { status: "delivered", timestamp: "1", recipient_id: "1" },
              ],
            },
          },
        ],
      },
    ],
  });
  assert.equal(events.length, 0);
  assert.deepEqual(parseWebhookEvents(null), []);
  assert.deepEqual(parseWebhookEvents({}), []);
  assert.deepEqual(parseWebhookEvents({ entry: "nope" }), []);
});
