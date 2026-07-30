import { logger } from "@/lib/logger";
import { normalizePhone } from "@/modules/participants/phone";
import {
  WHATSAPP_TEMPLATE_LANGUAGE_DEFAULT,
  resolveWhatsAppTemplate,
} from "./whatsapp-templates";
import type {
  ChannelAdapter,
  MessageChannel,
  OutboundMessage,
  SendResult,
} from "./types";

export type AdapterEnv = Partial<Record<string, string | undefined>>;
export type AdapterMode = "live" | "mock";

/** Abort hung Resend / Graph calls so the outbox worker cannot stall forever. */
const PROVIDER_REQUEST_TIMEOUT_MS = 15_000;

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

/**
 * Whether LIVE WhatsApp sends should use Meta-approved HSM templates instead of
 * free-form text. Off by default so behaviour is unchanged until the client
 * enables it (templates are required only for business-initiated sends outside
 * the 24h window). Never touches the network — purely an env toggle.
 */
export function isWhatsAppTemplateMode(env: AdapterEnv = process.env): boolean {
  return env.WHATSAPP_USE_TEMPLATES === "true";
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
    private readonly useTemplates = false,
    private readonly templateLanguage = WHATSAPP_TEMPLATE_LANGUAGE_DEFAULT,
  ) {}

  async send(message: OutboundMessage): Promise<SendResult> {
    try {
      // Template path only when explicitly enabled AND a mapping exists for the
      // message key; otherwise keep the existing free-form text send.
      const useTemplate =
        this.useTemplates && resolveWhatsAppTemplate(message.templateKey) !== null;
      const payload = useTemplate
        ? buildWhatsAppTemplatePayload(message, this.templateLanguage)
        : buildWhatsAppTextPayload(message);
      const response = await fetch(
        `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        },
      );

      if (!response.ok) {
        return { ok: false, error: await safeError(response) };
      }
      return { ok: true, providerMessageId: await parseProviderMessageId(response) };
    } catch (error: unknown) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "unknown",
      };
    }
  }
}

/**
 * Extract the provider-assigned message id from a WhatsApp Cloud API success
 * response (`{ messages: [{ id }] }`). Returns undefined on any unexpected
 * shape rather than throwing — a missing id must never fail an otherwise
 * successful send.
 */
async function parseProviderMessageId(
  response: Response,
): Promise<string | undefined> {
  try {
    const body = (await response.json()) as {
      messages?: Array<{ id?: unknown }>;
    };
    const id = body.messages?.[0]?.id;
    return typeof id === "string" && id.length > 0 ? id : undefined;
  } catch {
    return undefined;
  }
}

class ResendEmailAdapter implements ChannelAdapter {
  readonly channel = "email" as const;

  constructor(
    private readonly apiKey: string,
    private readonly fromEmail: string,
  ) {}

  async send(message: OutboundMessage): Promise<SendResult> {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      PROVIDER_REQUEST_TIMEOUT_MS,
    );
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(buildResendPayload(message, this.fromEmail)),
        signal: controller.signal,
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
    } finally {
      clearTimeout(timer);
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

/**
 * Builds a WhatsApp Cloud API `type:"template"` (HSM) payload for a message,
 * mapping the app template key → Meta template name + ordered params (body
 * variables and an optional URL-button parameter) via resolveWhatsAppTemplate.
 * Pure + network-free so it can be unit-tested without credentials.
 */
export function buildWhatsAppTemplatePayload(
  message: OutboundMessage,
  language: string = WHATSAPP_TEMPLATE_LANGUAGE_DEFAULT,
) {
  const phone = normalizePhone({ raw: message.recipient.phone }).normalized;
  if (!phone) throw new Error("WhatsApp recipient phone is missing");
  const config = resolveWhatsAppTemplate(message.templateKey);
  if (!config) {
    throw new Error(`No WhatsApp template mapping for ${message.templateKey}`);
  }
  const variables = message.variables ?? {};
  const components: Array<Record<string, unknown>> = [];
  if (config.bodyParams.length > 0) {
    components.push({
      type: "body",
      parameters: config.bodyParams.map((key) => ({
        type: "text",
        text: variables[key] ?? "",
      })),
    });
  }
  if (config.urlButtonParam) {
    const value = variables[config.urlButtonParam];
    if (value) {
      components.push({
        type: "button",
        sub_type: "url",
        index: "0",
        parameters: [{ type: "text", text: value }],
      });
    }
  }
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: phone,
    type: "template",
    template: {
      name: config.name,
      language: { code: language },
      components,
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
      isWhatsAppTemplateMode(env),
      env.WHATSAPP_TEMPLATE_LANGUAGE ?? WHATSAPP_TEMPLATE_LANGUAGE_DEFAULT,
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
