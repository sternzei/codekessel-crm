import { normalizePhone } from "@/modules/participants/phone";

// wa.me click-to-chat deep links need a *bare* international number: digits
// only, no leading "+", no "00", no spaces or punctuation. This module reuses
// the shared German phone normalization (the single source of truth for the
// trunk-"0" → country-code rule) and adds only the wa.me-specific concerns: a
// plausibility floor and URL assembly. It is deliberately network- and DB-free
// so it can be unit-tested in isolation.

const DEFAULT_COUNTRY_CODE = "49"; // Germany

// A dialable international MSISDN (country code + national number) is
// realistically at least this many digits. Anything shorter is treated as
// invalid so we never build a wa.me link to an obviously junk number.
const MIN_WA_ME_DIGITS = 8;

/**
 * Converts a raw phone number into the bare international digits wa.me expects
 * (no "+"/"00"/spaces). Delegates the German rules to {@link normalizePhone}: a
 * national trunk "0" becomes the default country code, and "+"/"00" prefixes
 * are dropped.
 * @returns the digits-only number, or null when empty/implausible.
 */
export function toWaMeNumber(
  rawPhone: string,
  defaultCountryCode: string = DEFAULT_COUNTRY_CODE,
): string | null {
  const { normalized } = normalizePhone({ raw: rawPhone, defaultCountryCode });
  if (!normalized) return null;
  if (normalized.length < MIN_WA_ME_DIGITS) return null;
  return normalized;
}

export type BuildWaMeUrlParams = {
  /** Already-normalized international digits (see {@link toWaMeNumber}). */
  readonly phone: string;
  /** Message body to prefill in the chat draft. */
  readonly text: string;
};

/**
 * Assembles a WhatsApp click-to-chat deep link with the message prefilled and
 * URL-encoded. `phone` must already be bare international digits.
 */
export function buildWaMeUrl({ phone, text }: BuildWaMeUrlParams): string {
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}
