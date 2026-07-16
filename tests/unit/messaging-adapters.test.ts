import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildResendPayload,
  buildWhatsAppTextPayload,
  resolveAdapterMode,
} from "@/modules/messaging/adapters";
import type { OutboundMessage } from "@/modules/messaging/types";

const message: OutboundMessage = {
  tenantId: "tenant-1",
  channel: "whatsapp",
  recipient: {
    kind: "participant",
    id: "participant-1",
    phone: "+49 151 1234567",
    email: "lena@example.de",
    displayName: "Lena",
  },
  subject: "Ihre Aufgabe",
  body: "Bitte öffnen Sie den Link.",
  templateKey: "task_confirm_availability",
  taskId: "task-1",
};

test("uses mock mode until the required channel credentials are present", () => {
  assert.equal(resolveAdapterMode("whatsapp", {}), "mock");
  assert.equal(
    resolveAdapterMode("whatsapp", {
      WHATSAPP_ACCESS_TOKEN: "token",
      WHATSAPP_PHONE_NUMBER_ID: "123",
    }),
    "live",
  );
  assert.equal(resolveAdapterMode("email", { RESEND_API_KEY: "key" }), "mock");
  assert.equal(
    resolveAdapterMode("email", {
      RESEND_API_KEY: "key",
      RESEND_FROM_EMAIL: "noreply@example.de",
    }),
    "live",
  );
});

test("builds a WhatsApp Cloud API text payload without logging PII", () => {
  assert.deepEqual(buildWhatsAppTextPayload(message), {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: "491511234567",
    type: "text",
    text: {
      preview_url: true,
      body: "Bitte öffnen Sie den Link.",
    },
  });
});

test("builds a Resend email payload", () => {
  assert.deepEqual(buildResendPayload(message, "QCG <noreply@example.de>"), {
    from: "QCG <noreply@example.de>",
    to: ["lena@example.de"],
    subject: "Ihre Aufgabe",
    text: "Bitte öffnen Sie den Link.",
  });
});

test("rejects missing recipient addresses before dispatch", () => {
  assert.throws(() =>
    buildWhatsAppTextPayload({
      ...message,
      recipient: { ...message.recipient, phone: null },
    }),
  );
  assert.throws(() =>
    buildResendPayload(
      { ...message, recipient: { ...message.recipient, email: null } },
      "QCG <noreply@example.de>",
    ),
  );
});

