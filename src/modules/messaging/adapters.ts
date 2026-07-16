import { logger } from "@/lib/logger";
import { normalizePhone } from "@/modules/participants/phone";
import type {
  ChannelAdapter,
  MessageChannel,
  OutboundMessage,
  SendResult,
} from "./types";

export type AdapterEnv = Partial<Record<string, string | undefined>>;
export type AdapterMode = "live" | "mock";

export function resolveAdapterMode(
  channel: MessageChannel,
  env: AdapterEnv = process.env,
): AdapterMode {
  if (channel === "whatsapp") {
    return env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID
      ? "live"
      : "mock";
  }
  return env.RESEND_API_KEY && env.RESEND_FROM_EMAIL ? "live" : "mock";
}

class MockAdapter implements ChannelAdapter {
  constructor(readonly channel: MessageChannel) {}

  async send(message: OutboundMessage): Promise<SendResult> {
    logger.info("mock message sent", {
      channel: this.channel,
      templateKey: message.templateKey,
      recipientKind: message.recipient.kind,
      recipientId: message.recipient.id,
      taskId: message.taskId ?? null,
    });
    return { ok: true };
  }
}

class WhatsAppCloudAdapter implements ChannelAdapter {
  readonly channel = "whatsapp" as const;

  constructor(
    private readonly accessToken: string,
    private readonly phoneNumberId: string,
    private readonly apiVersion = "v21.0",
  ) {}

  async send(message: OutboundMessage): Promise<SendResult> {
    try {
      const response = await fetch(
        `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(buildWhatsAppTextPayload(message)),
        },
      );

      if (!response.ok) {
        return { ok: false, error: await safeError(response) };
      }
      return { ok: true };
    } catch (error: unknown) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "unknown",
      };
    }
  }
}

class ResendEmailAdapter implements ChannelAdapter {
  readonly channel = "email" as const;

  constructor(
    private readonly apiKey: string,
    private readonly fromEmail: string,
  ) {}

  async send(message: OutboundMessage): Promise<SendResult> {
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(buildResendPayload(message, this.fromEmail)),
      });

      if (!response.ok) {
        return { ok: false, error: await safeError(response) };
      }
      return { ok: true };
    } catch (error: unknown) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "unknown",
      };
    }
  }
}

export function buildWhatsAppTextPayload(message: OutboundMessage) {
  const phone = normalizePhone({ raw: message.recipient.phone }).normalized;
  if (!phone) throw new Error("WhatsApp recipient phone is missing");

  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: phone,
    type: "text",
    text: {
      preview_url: true,
      body: message.body,
    },
  };
}

export function buildResendPayload(
  message: OutboundMessage,
  fromEmail: string,
) {
  if (!message.recipient.email) {
    throw new Error("Email recipient address is missing");
  }
  return {
    from: fromEmail,
    to: [message.recipient.email],
    subject: message.subject ?? "Ihre nächste Aufgabe",
    text: message.body,
  };
}

function createAdapter(
  channel: MessageChannel,
  env: AdapterEnv = process.env,
): ChannelAdapter {
  if (resolveAdapterMode(channel, env) === "mock") {
    return new MockAdapter(channel);
  }

  if (channel === "whatsapp") {
    return new WhatsAppCloudAdapter(
      env.WHATSAPP_ACCESS_TOKEN ?? "",
      env.WHATSAPP_PHONE_NUMBER_ID ?? "",
      env.WHATSAPP_API_VERSION ?? "v21.0",
    );
  }

  return new ResendEmailAdapter(
    env.RESEND_API_KEY ?? "",
    env.RESEND_FROM_EMAIL ?? "",
  );
}

async function safeError(response: Response): Promise<string> {
  const text = await response.text();
  return text.slice(0, 1000) || `${response.status} ${response.statusText}`;
}

export function getAdapter(channel: MessageChannel): ChannelAdapter {
  return createAdapter(channel);
}
