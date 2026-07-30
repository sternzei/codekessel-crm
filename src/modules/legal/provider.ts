import { env } from "@/lib/env";

/**
 * Operator identity behind the public pages. Everything is env-driven: the
 * platform is deployed per client, and an Impressum with hard-coded or invented
 * details would be worse than none at all.
 *
 * Outside production the three mandatory fields may be unset — the pages then
 * render a visible "not configured" notice instead of blanks, and `env.ts`
 * refuses to boot a production build without them.
 */
export type LegalProvider = {
  readonly name: string | null;
  readonly addressLines: readonly string[];
  readonly email: string | null;
  readonly phone: string | null;
  readonly representative: string | null;
  readonly registerEntry: string | null;
  readonly vatId: string | null;
  readonly supervisoryAuthority: string | null;
  /** Data protection officer; falls back to the general contact address. */
  readonly privacyContact: string | null;
  /** False when a mandatory field is missing (development only). */
  readonly isComplete: boolean;
};

const splitLines = (value: string | undefined): readonly string[] =>
  (value ?? "")
    .split(/\\n|\n/)
    .map((line) => line.trim())
    .filter(Boolean);

export const getLegalProvider = (): LegalProvider => {
  const addressLines = splitLines(env.LEGAL_PROVIDER_ADDRESS);
  const name = env.LEGAL_PROVIDER_NAME ?? null;
  const email = env.LEGAL_PROVIDER_EMAIL ?? null;
  return {
    name,
    addressLines,
    email,
    phone: env.LEGAL_PROVIDER_PHONE ?? null,
    representative: env.LEGAL_PROVIDER_REPRESENTATIVE ?? null,
    registerEntry: env.LEGAL_REGISTER_ENTRY ?? null,
    vatId: env.LEGAL_VAT_ID ?? null,
    supervisoryAuthority: env.LEGAL_SUPERVISORY_AUTHORITY ?? null,
    privacyContact: env.LEGAL_PRIVACY_CONTACT ?? email,
    isComplete: Boolean(name && addressLines.length > 0 && email),
  };
};
