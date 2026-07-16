import { and, eq } from "drizzle-orm";
import type { DbHandle } from "@/db/client";
import { messageTemplates } from "@/db/schema";

export type TemplateVariables = Record<string, string>;

export type RenderedMessage = { subject?: string; body: string };

/**
 * Loads a template from the DB and interpolates {{var}} placeholders.
 * Falls back to a neutral German default so a missing template never
 * blocks a task from reaching its owner.
 */
export async function renderTemplate(
  tx: DbHandle,
  key: string,
  channel: "whatsapp" | "email",
  variables: TemplateVariables,
): Promise<RenderedMessage> {
  const [template] = await tx
    .select()
    .from(messageTemplates)
    .where(
      and(
        eq(messageTemplates.key, key),
        eq(messageTemplates.channel, channel),
        eq(messageTemplates.active, true),
      ),
    );

  if (!template) {
    return {
      subject: variables.title ?? "Ihre nächste Aufgabe",
      body: `Hallo${variables.firstName ? ` ${variables.firstName}` : ""}, es gibt einen nächsten Schritt für Ihre geförderte Weiterbildung: ${variables.title ?? ""}${variables.link ? `\n\n${variables.link}` : ""} (PLATZHALTER)`,
    };
  }

  return {
    subject: template.subject ? interpolate(template.subject, variables) : undefined,
    body: interpolate(template.body, variables),
  };
}

export function interpolate(text: string, variables: TemplateVariables): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => variables[name] ?? "");
}
