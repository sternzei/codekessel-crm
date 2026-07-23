import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildResendPayload,
  buildWhatsAppTemplatePayload,
  buildWhatsAppTextPayload,
  isWhatsAppTemplateMode,
  resolveAdapterMode,
} from "@/modules/messaging/adapters";
import { resolveWhatsAppTemplate } from "@/modules/messaging/whatsapp-templates";
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

test("maps task_/reminder_ keys to a Meta template; ignores other keys", () => {
  assert.deepEqual(resolveWhatsAppTemplate("task_confirm_availability"), {
    name: "qcg_task_confirm_availability",
    bodyParams: ["firstName", "title"],
    urlButtonParam: "link",
  });
  assert.deepEqual(resolveWhatsAppTemplate("reminder_sign_document"), {
    name: "qcg_reminder_sign_document",
    bodyParams: ["firstName", "title"],
    urlButtonParam: "link",
  });
  assert.equal(resolveWhatsAppTemplate("welcome_email"), null);
  assert.equal(resolveWhatsAppTemplate("random"), null);
});

test("template mode is off unless WHATSAPP_USE_TEMPLATES is exactly 'true'", () => {
  assert.equal(isWhatsAppTemplateMode({}), false);
  assert.equal(isWhatsAppTemplateMode({ WHATSAPP_USE_TEMPLATES: "false" }), false);
  assert.equal(isWhatsAppTemplateMode({ WHATSAPP_USE_TEMPLATES: "1" }), false);
  assert.equal(isWhatsAppTemplateMode({ WHATSAPP_USE_TEMPLATES: "true" }), true);
});

test("builds a WhatsApp template (HSM) payload with ordered params + URL button", () => {
  assert.deepEqual(
    buildWhatsAppTemplatePayload(
      {
        ...message,
        variables: {
          firstName: "Lena",
          title: "Verfügbarkeit bestätigen",
          link: "https://app.qcg.de/t/abc.def.ghi",
        },
      },
      "de",
    ),
    {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "491511234567",
      type: "template",
      template: {
        name: "qcg_task_confirm_availability",
        language: { code: "de" },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: "Lena" },
              { type: "text", text: "Verfügbarkeit bestätigen" },
            ],
          },
          {
            type: "button",
            sub_type: "url",
            index: "0",
            parameters: [{ type: "text", text: "https://app.qcg.de/t/abc.def.ghi" }],
          },
        ],
      },
    },
  );
});

test("template payload omits the URL button when no link variable is present", () => {
  const payload = buildWhatsAppTemplatePayload({
    ...message,
    variables: { firstName: "Lena", title: "Verfügbarkeit bestätigen" },
  });
  assert.equal(payload.template.components.length, 1);
  assert.equal(payload.template.language.code, "de");
  assert.equal(payload.template.components[0].type, "body");
});

test("template payload builder still rejects a missing phone", () => {
  assert.throws(() =>
    buildWhatsAppTemplatePayload({
      ...message,
      recipient: { ...message.recipient, phone: null },
      variables: { firstName: "Lena", title: "X" },
    }),
  );
});

test("template payload builder rejects an unmapped template key", () => {
  assert.throws(() =>
    buildWhatsAppTemplatePayload({
      ...message,
      templateKey: "welcome_email",
      variables: { firstName: "Lena", title: "X" },
    }),
  );
});

