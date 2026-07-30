import { and, eq } from "drizzle-orm";
import type { DbHandle } from "@/db/client";
import { messageTemplates } from "@/db/schema";

export type TemplateVariables = Record<string, string>;

export type RenderedMessage = { subject?: string; body: string };

/**
 * Raised when a (key, channel) has no active row, or when a template references
 * a variable the caller did not supply. Both mean the same thing: we cannot
 * produce the intended text, and improvising one would send a participant
 * either placeholder copy or a sentence with a hole in it.
 */
export class TemplateRenderError extends Error {
  constructor(
    message: string,
    readonly templateKey: string,
    readonly channel: string,
  ) {
    super(message);
    this.name = "TemplateRenderError";
  }
}

export const isTemplateRenderError = (error: unknown): error is TemplateRenderError =>
  error instanceof TemplateRenderError;

/**
 * Loads a template from the DB and interpolates {{var}} placeholders.
 * Throws rather than falling back: every key the code can ask for is covered by
 * `src/modules/messaging/catalog.ts` and written by the seed, so a miss is a
 * misconfiguration that a human has to see — not something to paper over with
 * generic copy addressed to a real participant.
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
    throw new TemplateRenderError(
      `No active ${channel} template for key "${key}"`,
      key,
      channel,
    );
  }

  const missing = findMissingVariables(
    [template.subject ?? "", template.body].join("\n"),
    variables,
  );
  if (missing.length > 0) {
    throw new TemplateRenderError(
      `Template "${key}" (${channel}) references unresolved variables: ${missing.join(", ")}`,
      key,
      channel,
    );
  }

  return {
    subject: template.subject ? interpolate(template.subject, variables) : undefined,
    body: interpolate(template.body, variables),
  };
}

const PLACEHOLDER_PATTERN = /\{\{(\w+)\}\}/g;

/** Placeholder names used by `text` that `variables` does not define. */
export function findMissingVariables(
  text: string,
  variables: TemplateVariables,
): readonly string[] {
  const missing = new Set<string>();
  for (const [, name] of text.matchAll(PLACEHOLDER_PATTERN)) {
    if (variables[name] === undefined) missing.add(name);
  }
  return [...missing];
}

/** Names of the placeholders `text` uses, in order of first appearance. */
export function listPlaceholders(text: string): readonly string[] {
  return [...new Set([...text.matchAll(PLACEHOLDER_PATTERN)].map(([, name]) => name))];
}

export function interpolate(text: string, variables: TemplateVariables): string {
  return text.replace(PLACEHOLDER_PATTERN, (_, name: string) => variables[name] ?? "");
}
