import type {
  FundingStatus,
  QualificationEntry,
  SalaryComponent,
  StaffingBand,
  WeeklyTimes,
  Weekday,
} from "@/db/schema";

// Conservative parsing + validation for the Epic A "missing BA data" fields.
// Validators are deliberately lenient about *emptiness* (the caller decides
// whether a field is required) and strict only about *format*, so a genuinely
// valid input is never rejected. Structured jsonb sets are parsed from a plain
// key→value reader so the same code is unit-testable without a FormData/DB.

/** Reads one form value by name. Returns undefined when absent. */
export type FieldReader = (key: string) => string | undefined;

const WEEKDAYS: readonly Weekday[] = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
];

/** Fixed working-hours bands for employer head-counts (Stunden-Faktoren). */
export const STAFFING_BANDS = [
  { key: "unter_20h", label: "unter 20 Std./Woche" },
  { key: "20_bis_30h", label: "20 bis unter 30 Std./Woche" },
  { key: "30_und_mehr", label: "30 Std./Woche und mehr" },
] as const;

const MAX_SALARY_COMPONENTS = 3;

export function normalizeIban(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase();
}

/**
 * ISO 13616 IBAN check: structural shape + ISO 7064 mod-97 checksum. A
 * correctly-typed IBAN always passes, so this never rejects a valid input.
 */
export function isValidIban(raw: string): boolean {
  const iban = normalizeIban(raw);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const value =
      ch >= "A" && ch <= "Z" ? (ch.charCodeAt(0) - 55).toString() : ch;
    for (const digit of value) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  return remainder === 1;
}

export function normalizeBic(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase();
}

/** SWIFT/BIC shape: 8 or 11 chars (6 letters + 2 alnum + optional 3 alnum). */
export function isValidBic(raw: string): boolean {
  return /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(normalizeBic(raw));
}

export function normalizeSvNumber(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase();
}

/**
 * German Sozialversicherungsnummer shape (12 chars): 2-digit Bereichsnummer,
 * 6-digit birth date, 1 letter (first of birth surname), 2-digit serial,
 * 1 check digit. Structure only — the check-digit algorithm is intentionally
 * not enforced to avoid rejecting legitimate historical numbers.
 */
export function isValidSvNumber(raw: string): boolean {
  return /^\d{8}[A-Z]\d{3}$/.test(normalizeSvNumber(raw));
}

/** Parses a decimal amount (accepts a comma) into a numeric-column string. */
export function parseDecimalString(raw: string | undefined): string | null {
  const trimmed = (raw ?? "").trim().replace(",", ".");
  if (!trimmed) return null;
  const value = Number(trimmed);
  if (Number.isNaN(value) || value < 0) return null;
  return value.toString();
}

export function parseWeeklyTimes(read: FieldReader): WeeklyTimes | null {
  const result: WeeklyTimes = {};
  for (const day of WEEKDAYS) {
    const from = (read(`schulung_${day}_from`) ?? "").trim();
    const to = (read(`schulung_${day}_to`) ?? "").trim();
    if (from && to) result[day] = { from, to };
  }
  return Object.keys(result).length > 0 ? result : null;
}

export function parseQualificationHistory(
  read: FieldReader,
): QualificationEntry[] | null {
  const beruf = (read("qualBeruf") ?? "").trim();
  if (!beruf) return null;
  return [
    {
      beruf,
      abschlussdatum: (read("qualAbschlussdatum") ?? "").trim() || null,
      ausbildungVon: (read("qualAusbildungVon") ?? "").trim() || null,
      ausbildungBis: (read("qualAusbildungBis") ?? "").trim() || null,
    },
  ];
}

export function parseFundingStatus(read: FieldReader): FundingStatus | null {
  const isOn = (key: string): boolean => {
    const value = read(key);
    return value === "on" || value === "true";
  };
  const kug = isOn("fundingKug");
  const egz = isOn("fundingEgz");
  const other = (read("fundingOther") ?? "").trim();
  if (!kug && !egz && !other) return null;
  return {
    ...(kug ? { kug: true } : {}),
    ...(egz ? { egz: true } : {}),
    ...(other ? { other } : {}),
  };
}

export function parseSalaryComponents(
  read: FieldReader,
): SalaryComponent[] | null {
  const out: SalaryComponent[] = [];
  for (let i = 0; i < MAX_SALARY_COMPONENTS; i += 1) {
    const label = (read(`salaryLabel${i}`) ?? "").trim();
    const amount = parseDecimalString(read(`salaryAmount${i}`));
    if (label && amount != null) out.push({ label, amountEur: Number(amount) });
  }
  return out.length > 0 ? out : null;
}

export function parseStaffingBands(read: FieldReader): StaffingBand[] | null {
  const out: StaffingBand[] = [];
  for (const band of STAFFING_BANDS) {
    const raw = (read(`staffing_${band.key}`) ?? "").trim();
    if (!raw) continue;
    const count = Number(raw);
    if (!Number.isInteger(count) || count < 0) continue;
    out.push({ band: band.key, count });
  }
  return out.length > 0 ? out : null;
}
