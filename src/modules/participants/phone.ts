// Conservative phone normalization shared across import, messaging, and the
// contact-update flows. The goal is a single *comparable* representation so
// the same German number written in different ways dedups correctly, WITHOUT
// destroying information or producing false matches between distinct numbers.
//
// Rules (deliberately conservative):
//  * Keep the caller's original formatting verbatim (`original`).
//  * Produce a digits-only canonical value WITHOUT a leading "+".
//  * International prefixes ("+" and "00") are recognised and dropped.
//  * A single national trunk "0" is converted to the default country code —
//    we never *blindly* strip leading zeros, only the one trunk prefix.
//  * Numbers that are already prefix-less and trunk-less are left as-is
//    (we do not guess a country code and risk corrupting them).

const DEFAULT_COUNTRY_CODE = "49"; // Germany

// A national significant number is normally >= this many digits. Suffix
// comparison below refuses to match anything shorter, so two short/partial
// numbers that merely share a tail are never treated as equal.
const MIN_SIGNIFICANT_DIGITS = 9;

export type NormalizePhoneInput = {
  readonly raw: string | null | undefined;
  /** Country code (digits, no "+") assumed for national-format numbers. */
  readonly defaultCountryCode?: string;
};

export type NormalizedPhone = {
  /** The trimmed value exactly as supplied, or null when blank. */
  readonly original: string | null;
  /** Comparable digits-only value (no "+"), or null when no digits. */
  readonly normalized: string | null;
};

/**
 * Normalizes one phone number into a comparable digits-only form.
 * @returns {@link NormalizedPhone} — `original` preserves the input, while
 * `normalized` is the canonical value used for storage and comparison.
 */
export function normalizePhone(input: NormalizePhoneInput): NormalizedPhone {
  const original = input.raw?.trim() || null;
  if (!original) return { original: null, normalized: null };
  const countryCode = input.defaultCountryCode ?? DEFAULT_COUNTRY_CODE;
  const digits = original.replace(/[^\d]/g, "");
  if (!digits) return { original, normalized: null };
  const hasPlus = original.trimStart().startsWith("+");
  if (hasPlus) return { original, normalized: digits };
  if (digits.startsWith("00")) {
    return { original, normalized: digits.slice(2) };
  }
  if (digits.startsWith("0")) {
    return { original, normalized: `${countryCode}${digits.slice(1)}` };
  }
  return { original, normalized: digits };
}

/**
 * Conservative equality for two phone numbers. Equal when their canonical
 * forms match exactly, or — as a controlled fallback — when one is a suffix
 * of the other AND the shorter value still has enough significant digits to
 * make an accidental collision implausible.
 */
export function arePhonesEquivalent(
  first: string | null | undefined,
  second: string | null | undefined,
): boolean {
  const a = normalizePhone({ raw: first }).normalized;
  const b = normalizePhone({ raw: second }).normalized;
  if (!a || !b) return false;
  if (a === b) return true;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (shorter.length < MIN_SIGNIFICANT_DIGITS) return false;
  return longer.endsWith(shorter);
}
