// Shared jsonb shapes for the Epic A "missing BA data" columns (plan.md §186).
// Kept in one place so participants/employers, the collectApplicationData DTO
// and the BA form builders all agree on the structure. Every field is
// optional/nullable: the data is captured incrementally through the portals.

/** ISO weekday keys used for per-weekday training-time sets (Schulungszeiten). */
export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

/** One weekday's training window, e.g. { from: "09:00", to: "16:30" }. */
export type WeekdayTime = { from: string; to: string };

/** Per-weekday training times (Arbeitszeitrahmen + Schulungszeiten). */
export type WeeklyTimes = Partial<Record<Weekday, WeekdayTime>>;

/** A named salary/Gehalt component on top of the monthly gross. */
export type SalaryComponent = { label: string; amountEur: number };

/** One qualification/Berufsabschluss entry (Berufsabschluss-Historie). */
export type QualificationEntry = {
  /** Berufsbezeichnung, e.g. "Fachinformatiker/in". */
  beruf: string;
  /** Zeugnisdatum (ISO date) when the certificate was issued, if known. */
  abschlussdatum: string | null;
  /** Ausbildungszeitraum, if captured. */
  ausbildungVon?: string | null;
  ausbildungBis?: string | null;
};

/** Funding/subsidy status of the participant (KuG/EGZ-Status). */
export type FundingStatus = {
  /** Kurzarbeitergeld. */
  kug?: boolean;
  /** Eingliederungszuschuss. */
  egz?: boolean;
  /** Any other subsidy, free text. */
  other?: string;
};

/**
 * Head-count in one working-hours band (Beschäftigtenzahlen nach
 * Stunden-Faktoren). `band` is a stable key (see STAFFING_BANDS), `count` the
 * number of employees in that band.
 */
export type StaffingBand = { band: string; count: number };
