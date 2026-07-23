export type MessageChannel = "whatsapp" | "email";

export type Recipient = {
  kind: "participant" | "employer";
  id: string;
  // Resolved address; adapters need it, logs must never contain it.
  email?: string | null;
  phone?: string | null;
  displayName?: string | null;
};

export type OutboundMessage = {
  tenantId: string;
  channel: MessageChannel;
  recipient: Recipient;
  subject?: string;
  body: string;
  templateKey: string;
  taskId?: string;
  // Raw interpolation variables (firstName, title, link, …). Carried so the
  // WhatsApp adapter can fill an HSM template's ordered params; the text/email
  // paths ignore it and use the already-rendered body.
  variables?: Record<string, string>;
};

export type SendResult = { ok: true } | { ok: false; error: string };

// One adapter per channel. Mock adapters ship first; the WhatsApp Business
// Cloud API and Resend implementations drop in behind this interface once
// the client provides credentials (Phase 3 hand-off point).
export interface ChannelAdapter {
  readonly channel: MessageChannel;
  send(message: OutboundMessage): Promise<SendResult>;
}
