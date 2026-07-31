import assert from "node:assert/strict";
import test from "node:test";
import { resolveDeliveryChannel } from "@/modules/messaging/channel";

// Without WhatsApp credentials the adapter is a mock: it reports success and
// the participant hears nothing. These pin when the message is rerouted to
// email instead, and when the rule's own channel is kept.

const LIVE_EMAIL = {
  RESEND_API_KEY: "re_9fKq2LpXnQvRt3Yw8ZbNhU4kKq2LpXnQ",
  RESEND_FROM_EMAIL: "no-reply@example.org",
};
const LIVE_WHATSAPP = {
  WHATSAPP_ACCESS_TOKEN: "EAAG9ZBpZAcZAuIBO7ZCq0mVdF4kKq2LpXnQvRt3Yw8ZbNhU",
  WHATSAPP_PHONE_NUMBER_ID: "123456789012345",
};
const RECIPIENT = { phone: "+4915112345678", email: "teilnehmer@example.org" };

test("a mocked WhatsApp send goes out by email when email is live", () => {
  const actual = resolveDeliveryChannel({
    preferred: "whatsapp",
    recipient: RECIPIENT,
    env: LIVE_EMAIL,
  });
  assert.equal(actual, "email");
});

test("a live WhatsApp send stays on WhatsApp", () => {
  const actual = resolveDeliveryChannel({
    preferred: "whatsapp",
    recipient: RECIPIENT,
    env: { ...LIVE_EMAIL, ...LIVE_WHATSAPP },
  });
  assert.equal(actual, "whatsapp");
});

test("with both providers mocked the rule's channel is kept", () => {
  // Rerouting would gain nothing and would misreport which channel was used.
  const actual = resolveDeliveryChannel({
    preferred: "whatsapp",
    recipient: RECIPIENT,
    env: {},
  });
  assert.equal(actual, "whatsapp");
});

test("without an address there is nothing to fall back to", () => {
  const actual = resolveDeliveryChannel({
    preferred: "whatsapp",
    recipient: { phone: RECIPIENT.phone, email: null },
    env: LIVE_EMAIL,
  });
  assert.equal(actual, "whatsapp");
});

test("an email rule is never rerouted to WhatsApp", () => {
  const actual = resolveDeliveryChannel({
    preferred: "email",
    recipient: RECIPIENT,
    env: LIVE_WHATSAPP,
  });
  assert.equal(actual, "email");
});
