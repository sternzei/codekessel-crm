import { resolveAdapterMode, type AdapterEnv } from "./adapters";
import type { MessageChannel, Recipient } from "./types";

// Which channel a message actually leaves on.
//
// Without WhatsApp credentials the WhatsApp adapter is a mock: it logs, returns
// success, and the row reads "gesendet" while the participant received nothing.
// That is the worst failure mode we have — invisible. So when WhatsApp cannot
// really deliver and email can, the message goes out by email instead.
//
// The fallback is deliberately one-directional. A rule that asks for email is
// asking for something a mail client can render (links, longer text), so it is
// never rerouted to WhatsApp. And if email is mocked too, nothing is gained by
// switching, so the rule's own channel is kept and the record stays honest.

export type DeliveryChannelParams = {
  readonly preferred: MessageChannel;
  readonly recipient: Pick<Recipient, "phone" | "email">;
  readonly env?: AdapterEnv;
};

export function resolveDeliveryChannel({
  preferred,
  recipient,
  env = process.env,
}: DeliveryChannelParams): MessageChannel {
  if (preferred !== "whatsapp") return preferred;
  if (!recipient.email) return preferred;
  const whatsappIsMocked = resolveAdapterMode("whatsapp", env) === "mock";
  const emailIsLive = resolveAdapterMode("email", env) === "live";
  return whatsappIsMocked && emailIsLive ? "email" : preferred;
}
