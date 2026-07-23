// Maps an app message key (`task_<type>` / `reminder_<type>`) to a
// Meta-approved WhatsApp template (HSM). Business-initiated messages sent
// OUTSIDE the 24-hour customer-service window must use an approved template,
// so live sends need this mapping in addition to the free-form `text` path.
//
// DECISION — code constant, NOT a DB column: the Meta template catalogue is
// approved in WhatsApp Manager (outside our DB), the mapping is uniform across
// tenants, and this needs no migration and stays versioned with the app. If
// per-tenant template names ever diverge, add a nullable
// `message_templates.meta_template_name` column then (migration 0010) and let
// it override this default — the resolver is the single seam to change.

export const WHATSAPP_TEMPLATE_LANGUAGE_DEFAULT = "de";

export type WhatsAppTemplateConfig = {
  /** Meta-approved template name, as configured in WhatsApp Manager. */
  name: string;
  /** Ordered body variable keys → {{1}}, {{2}}, … in the approved template. */
  bodyParams: readonly string[];
  /** Variable key whose value fills a dynamic URL-button parameter, if any. */
  urlButtonParam?: string;
};

// Every app task_/reminder_ message shares one shape (greeting + task title +
// magic link), so a single deterministic mapping covers all keys: template
// name `qcg_<key>`, body params [firstName, title], URL button param = link.
const TEMPLATE_NAME_PREFIX = "qcg_";
const DEFAULT_BODY_PARAMS = ["firstName", "title"] as const;
const DEFAULT_URL_BUTTON_PARAM = "link";
const TEMPLATE_KEY_PATTERN = /^(task|reminder)_[a-z0-9_]+$/;

// Explicit overrides for keys needing a different Meta template or param order.
// Unlisted task_/reminder_ keys fall back to the deterministic default above.
const TEMPLATE_OVERRIDES: Record<string, WhatsAppTemplateConfig> = {};

/**
 * Resolve the Meta template config for an app message key, or null when the
 * key has no template mapping (e.g. an ad-hoc/non-task key) — the adapter then
 * falls back to the free-form text path.
 */
export function resolveWhatsAppTemplate(
  templateKey: string,
): WhatsAppTemplateConfig | null {
  const override = TEMPLATE_OVERRIDES[templateKey];
  if (override) return override;
  if (!TEMPLATE_KEY_PATTERN.test(templateKey)) return null;
  return {
    name: `${TEMPLATE_NAME_PREFIX}${templateKey}`,
    bodyParams: DEFAULT_BODY_PARAMS,
    urlButtonParam: DEFAULT_URL_BUTTON_PARAM,
  };
}
