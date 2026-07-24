import {
  and,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  or,
  type SQL,
} from "drizzle-orm";
import { participants } from "@/db/schema";
import { PIPELINE_STATUS_ORDER, type ParticipantStatus } from "./queries";

// ---------------------------------------------------------------------------
// Pure filter + KPI logic for the pipeline workspace. This module is
// deliberately DB-connection-free (it only imports the Drizzle table
// definition + operators, which build SQL AST without touching a pool) so the
// filter-to-SQL builder and every KPI/funnel calculation can be unit tested
// without a database. The DB-access layer (pipeline.ts) consumes these.
// ---------------------------------------------------------------------------

const REAL_STATUSES = new Set<string>(PIPELINE_STATUS_ORDER);

/** Terminal drop-out statuses (a lead left the pipeline unsuccessfully). */
export const LOST_STATUSES: ParticipantStatus[] = ["lost", "not_interested"];

/** Success terminal status. */
export const WON_STATUSES: ParticipantStatus[] = ["enrolled"];

/**
 * Still needs work: everything except the terminal drop-outs and the won
 * end-state. This is the operational "open leads" set.
 */
export const OPEN_STATUSES: ParticipantStatus[] = PIPELINE_STATUS_ORDER.filter(
  (s) => !LOST_STATUSES.includes(s) && !WON_STATUSES.includes(s),
);

/**
 * "Reached": a qualifying conversation demonstrably happened. Only statuses a
 * lead can reach *after* actually speaking with them. `new`, `called`,
 * `not_reachable` and `wrong_number` are contact *attempts* (or bad data), not
 * confirmed reach — so they are excluded on purpose. This is the defensible
 * replacement for the older, misleading `contacted = status <> 'new'` notion.
 */
export const REACHED_STATUSES: ParticipantStatus[] = [
  "interested",
  "not_interested",
  "eligibility_unclear",
  "employer_pending",
  "qualified",
  "test_phase",
  "documents_phase",
  "application_phase",
  "enrolled",
];

/** Passed the mandatory 20h/6-month availability gate (qualified and beyond). */
export const QUALIFIED_PLUS_STATUSES: ParticipantStatus[] = [
  "qualified",
  "test_phase",
  "documents_phase",
  "application_phase",
  "enrolled",
];

/** Reached the application stage or beyond ("converted to application"). */
export const APPLICATION_PLUS_STATUSES: ParticipantStatus[] = [
  "application_phase",
  "enrolled",
];

/** Contact/data problems: attempted but not usable. */
export const UNREACHABLE_STATUSES: ParticipantStatus[] = [
  "not_reachable",
  "wrong_number",
];

/** A `new` lead older than this many days is a stale-lead bottleneck. */
export const STALE_NEW_DAYS = 7;

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export type ContactPresence = "with" | "without";
export type PipelineSort = "created" | "updated" | "name" | "status";
export type SortDir = "asc" | "desc";

/**
 * The single filter definition shared by BOTH the aggregate (KPI/funnel) and
 * the paginated list query. Because both callers derive their SQL from the
 * exact same object via {@link buildPipelineConditions}, counts and lists can
 * never disagree.
 */
export interface PipelineFilter {
  statuses: ParticipantStatus[];
  consultantId?: string;
  unassigned?: boolean;
  source?: string;
  createdFrom?: Date;
  createdUntil?: Date;
  phone?: ContactPresence;
  email?: ContactPresence;
  search?: string;
}

export interface PipelineListParams {
  filter: PipelineFilter;
  page: number;
  pageSize: number;
  sort: PipelineSort;
  dir: SortDir;
}

type RawSearchParams = Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  const trimmed = v?.trim();
  return trimmed ? trimmed : undefined;
}

function parseStatuses(
  value: string | string[] | undefined,
): ParticipantStatus[] {
  const raw = Array.isArray(value) ? value : value ? value.split(",") : [];
  const seen = new Set<ParticipantStatus>();
  for (const item of raw) {
    const status = item.trim();
    if (REAL_STATUSES.has(status)) seen.add(status as ParticipantStatus);
  }
  return [...seen];
}

function parseDate(value: string | undefined, endOfDay = false): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return undefined;
  // Mirror the reports page: `until` covers the whole selected day.
  if (endOfDay) d.setHours(23, 59, 59, 999);
  return d;
}

function parsePresence(
  value: string | undefined,
): ContactPresence | undefined {
  if (value === "with" || value === "missing" || value === "without") {
    return value === "with" ? "with" : "without";
  }
  return undefined;
}

/** Parse Next.js `searchParams` into the canonical filter (pure). */
export function parsePipelineFilter(raw: RawSearchParams): PipelineFilter {
  const consultantValue = firstValue(raw.consultant);
  const unassigned = consultantValue === "unassigned";
  return {
    statuses: parseStatuses(raw.status),
    consultantId: unassigned ? undefined : consultantValue,
    unassigned,
    source: firstValue(raw.source),
    createdFrom: parseDate(firstValue(raw.createdFrom)),
    createdUntil: parseDate(firstValue(raw.createdUntil), true),
    phone: parsePresence(firstValue(raw.phone)),
    email: parsePresence(firstValue(raw.email)),
    search: firstValue(raw.q),
  };
}

function toDateInput(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * The exact inverse of {@link parsePipelineFilter}: serialise a filter back to
 * the URL query string the pipeline page reads. Because presets (below) round-
 * trip through this and the parser, a preset link produces the identical filter
 * — and therefore the identical shared {@link buildPipelineConditions} — so its
 * KPIs and list can never disagree with a hand-built filter.
 */
export function serializePipelineFilter(filter: PipelineFilter): string {
  const params = new URLSearchParams();
  if (filter.statuses.length > 0) params.set("status", filter.statuses.join(","));
  if (filter.unassigned) params.set("consultant", "unassigned");
  else if (filter.consultantId) params.set("consultant", filter.consultantId);
  if (filter.source) params.set("source", filter.source);
  if (filter.createdFrom) params.set("createdFrom", toDateInput(filter.createdFrom));
  if (filter.createdUntil) params.set("createdUntil", toDateInput(filter.createdUntil));
  if (filter.phone) params.set("phone", filter.phone);
  if (filter.email) params.set("email", filter.email);
  if (filter.search) params.set("q", filter.search);
  return params.toString();
}

// Canonical, order-independent key for a filter so two filters that select the
// same leads compare equal regardless of how they were built (used to highlight
// the active preset).
function filterKey(filter: PipelineFilter): string {
  return JSON.stringify({
    statuses: [...filter.statuses].sort(),
    consultantId: filter.consultantId ?? null,
    unassigned: Boolean(filter.unassigned),
    source: filter.source ?? null,
    phone: filter.phone ?? null,
    email: filter.email ?? null,
    search: filter.search ?? null,
    createdFrom: filter.createdFrom?.getTime() ?? null,
    createdUntil: filter.createdUntil?.getTime() ?? null,
  });
}

/** True when two filters select the identical set of leads. */
export function filtersEqual(a: PipelineFilter, b: PipelineFilter): boolean {
  return filterKey(a) === filterKey(b);
}

export interface PipelinePreset {
  key: string;
  label: string;
  description: string;
  filter: PipelineFilter;
}

// Saved one-click filter views for the operational workspace. Each is a plain
// PipelineFilter, so it reuses the exact shared filter→SQL layer — no divergent
// query. Deliberately status/contact-based (no date ranges) so the preset link
// round-trips serialize↔parse exactly.
export const PIPELINE_PRESETS: PipelinePreset[] = [
  {
    key: "needs_first_call",
    label: "Erstkontakt offen",
    description: "Neue Leads, die noch nie angerufen wurden.",
    filter: { statuses: ["new"] },
  },
  {
    key: "unreachable",
    label: "Nicht erreichbar",
    description: "Nicht erreicht oder falsche Nummer — erneut versuchen.",
    filter: { statuses: [...UNREACHABLE_STATUSES] },
  },
  {
    key: "employer_pending",
    label: "Arbeitgeber offen",
    description: "Warten auf die Freigabe des Arbeitgebers.",
    filter: { statuses: ["employer_pending"] },
  },
  {
    key: "qualified_plus",
    label: "Qualifiziert+",
    description: "Verfügbarkeit bestätigt und weiter im Funnel.",
    filter: { statuses: [...QUALIFIED_PLUS_STATUSES] },
  },
  {
    key: "in_application",
    label: "In Antrag",
    description: "Antragsphase und eingeschrieben.",
    filter: { statuses: [...APPLICATION_PLUS_STATUSES] },
  },
  {
    key: "missing_phone",
    label: "Ohne Telefon",
    description: "Offene Leads ohne erfasste Telefonnummer.",
    filter: { statuses: [], phone: "without" },
  },
  {
    key: "unassigned",
    label: "Nicht zugewiesen",
    description: "Leads ohne zuständige Beratung.",
    filter: { statuses: [], unassigned: true },
  },
];

/** The `/pipeline` query string for a preset (pure). */
export function buildPresetQuery(preset: PipelinePreset): string {
  return serializePipelineFilter(preset.filter);
}

/** Whether a preset is the currently-applied filter (for active highlighting). */
export function isPresetActive(
  preset: PipelinePreset,
  filter: PipelineFilter,
): boolean {
  return filtersEqual(preset.filter, filter);
}

function clampInt(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const n = Number(value);
  if (!Number.isInteger(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

const SORT_VALUES = new Set<PipelineSort>([
  "created",
  "updated",
  "name",
  "status",
]);

/** Parse list pagination + sorting from `searchParams` (pure). */
export function parsePipelineListParams(
  raw: RawSearchParams,
): PipelineListParams {
  const sortRaw = firstValue(raw.sort);
  const dirRaw = firstValue(raw.dir);
  return {
    filter: parsePipelineFilter(raw),
    page: clampInt(firstValue(raw.page), 1, 1, 1_000_000),
    pageSize: clampInt(
      firstValue(raw.pageSize),
      DEFAULT_PAGE_SIZE,
      1,
      MAX_PAGE_SIZE,
    ),
    sort:
      sortRaw && SORT_VALUES.has(sortRaw as PipelineSort)
        ? (sortRaw as PipelineSort)
        : "created",
    dir: dirRaw === "asc" ? "asc" : "desc",
  };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * The one and only filter → SQL translation. Returns an array of conditions
 * (undefined predicates omitted) so callers combine with `and(...)`. Each
 * active filter contributes exactly one condition, which keeps the mapping
 * predictable and unit-testable without a database.
 */
export function buildPipelineConditions(filter: PipelineFilter): SQL[] {
  const conditions: SQL[] = [];
  if (filter.statuses.length > 0) {
    conditions.push(inArray(participants.status, filter.statuses));
  }
  if (filter.unassigned) {
    conditions.push(isNull(participants.assignedConsultantId));
  } else if (filter.consultantId) {
    conditions.push(eq(participants.assignedConsultantId, filter.consultantId));
  }
  if (filter.source) {
    conditions.push(eq(participants.source, filter.source));
  }
  if (filter.createdFrom) {
    conditions.push(gte(participants.createdAt, filter.createdFrom));
  }
  if (filter.createdUntil) {
    conditions.push(lte(participants.createdAt, filter.createdUntil));
  }
  if (filter.phone === "with") {
    conditions.push(
      and(
        isNotNull(participants.phoneNormalized),
        ne(participants.phoneNormalized, ""),
      ) as SQL,
    );
  } else if (filter.phone === "without") {
    conditions.push(
      or(
        isNull(participants.phoneNormalized),
        eq(participants.phoneNormalized, ""),
      ) as SQL,
    );
  }
  if (filter.email === "with") {
    conditions.push(
      and(isNotNull(participants.email), ne(participants.email, "")) as SQL,
    );
  } else if (filter.email === "without") {
    conditions.push(
      or(isNull(participants.email), eq(participants.email, "")) as SQL,
    );
  }
  if (filter.search) {
    const term = `%${escapeLike(filter.search)}%`;
    conditions.push(
      or(
        ilike(participants.firstName, term),
        ilike(participants.lastName, term),
        ilike(participants.city, term),
      ) as SQL,
    );
  }
  return conditions;
}

// ---------------------------------------------------------------------------
// Pure KPI / funnel / conversion calculations. These operate on plain counts
// (a status → count map produced by a GROUP BY status query) so they are fully
// unit-testable and never touch the database.
// ---------------------------------------------------------------------------

export type StatusCounts = Partial<Record<ParticipantStatus, number>>;

export interface CoverageCounts {
  total: number;
  withPhone: number;
  withEmail: number;
}

export interface PipelineKpis {
  total: number;
  open: number;
  needsFirstCall: number;
  reached: number;
  reachedRate: number | null;
  interested: number;
  qualifiedPlus: number;
  qualifiedRate: number | null;
  employerPending: number;
  unreachable: number;
  applicationPlus: number;
  lost: number;
  lostRate: number | null;
  withPhone: number;
  phoneCoverage: number | null;
  withEmail: number;
  emailCoverage: number | null;
}

/** One decimal percentage, or null when the denominator is zero. */
export function rate(numerator: number, denominator: number): number | null {
  return denominator === 0
    ? null
    : Math.round((numerator / denominator) * 1000) / 10;
}

function sumStatuses(counts: StatusCounts, statuses: ParticipantStatus[]): number {
  return statuses.reduce((total, status) => total + (counts[status] ?? 0), 0);
}

export function totalFromCounts(counts: StatusCounts): number {
  return PIPELINE_STATUS_ORDER.reduce(
    (total, status) => total + (counts[status] ?? 0),
    0,
  );
}

/** Derive the operational KPIs from grouped counts + coverage counts (pure). */
export function deriveKpis(
  counts: StatusCounts,
  coverage: CoverageCounts,
): PipelineKpis {
  const total = coverage.total;
  const reached = sumStatuses(counts, REACHED_STATUSES);
  const qualifiedPlus = sumStatuses(counts, QUALIFIED_PLUS_STATUSES);
  const lost = sumStatuses(counts, LOST_STATUSES);
  return {
    total,
    open: sumStatuses(counts, OPEN_STATUSES),
    needsFirstCall: counts.new ?? 0,
    reached,
    reachedRate: rate(reached, total),
    interested: counts.interested ?? 0,
    qualifiedPlus,
    qualifiedRate: rate(qualifiedPlus, total),
    employerPending: counts.employer_pending ?? 0,
    unreachable: sumStatuses(counts, UNREACHABLE_STATUSES),
    applicationPlus: sumStatuses(counts, APPLICATION_PLUS_STATUSES),
    lost,
    lostRate: rate(lost, total),
    withPhone: coverage.withPhone,
    phoneCoverage: rate(coverage.withPhone, total),
    withEmail: coverage.withEmail,
    emailCoverage: rate(coverage.withEmail, total),
  };
}

export interface FunnelStage {
  status: ParticipantStatus;
  count: number;
}

/** Count per real status in the canonical pipeline order (pure). */
export function buildFunnel(counts: StatusCounts): FunnelStage[] {
  return PIPELINE_STATUS_ORDER.map((status) => ({
    status,
    count: counts[status] ?? 0,
  }));
}

export type ConversionKey =
  | "worked"
  | "reached"
  | "qualified"
  | "application"
  | "enrolled";

export interface ConversionStep {
  key: ConversionKey;
  numerator: number;
  denominator: number;
  rate: number | null;
}

/**
 * Conversion between adjacent *meaningful* macro-stages of the funnel (pure).
 * Each step is an explicit numerator/denominator so the UI can caption it.
 */
export function computeConversions(counts: StatusCounts): ConversionStep[] {
  const total = totalFromCounts(counts);
  const worked = total - (counts.new ?? 0);
  const reached = sumStatuses(counts, REACHED_STATUSES);
  const qualified = sumStatuses(counts, QUALIFIED_PLUS_STATUSES);
  const application = sumStatuses(counts, APPLICATION_PLUS_STATUSES);
  const enrolled = counts.enrolled ?? 0;
  const step = (
    key: ConversionKey,
    numerator: number,
    denominator: number,
  ): ConversionStep => ({ key, numerator, denominator, rate: rate(numerator, denominator) });
  return [
    step("worked", worked, total),
    step("reached", reached, worked),
    step("qualified", qualified, reached),
    step("application", application, qualified),
    step("enrolled", enrolled, application),
  ];
}

export type NextActionKey =
  | "call"
  | "log_outcome"
  | "retry_call"
  | "fix_number"
  | "qualify"
  | "clarify_eligibility"
  | "follow_employer"
  | "invite_test"
  | "track_test"
  | "collect_docs"
  | "track_application"
  | "none";

const NEXT_ACTION: Record<ParticipantStatus, NextActionKey> = {
  new: "call",
  called: "log_outcome",
  not_reachable: "retry_call",
  wrong_number: "fix_number",
  interested: "qualify",
  not_interested: "none",
  eligibility_unclear: "clarify_eligibility",
  employer_pending: "follow_employer",
  qualified: "invite_test",
  test_phase: "track_test",
  documents_phase: "collect_docs",
  application_phase: "track_application",
  enrolled: "none",
  lost: "none",
};

/** The suggested next operational action for a lead in a given status (pure). */
export function nextActionKey(status: ParticipantStatus): NextActionKey {
  return NEXT_ACTION[status];
}

export interface ExportRow {
  firstName: string;
  lastName: string;
  status: string;
  city: string | null;
  source: string | null;
  consultantName: string | null;
  phone: string | null;
  email: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function csvCell(value: string | null | undefined): string {
  const text = value ?? "";
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** Serialise the current (filtered) result set to CSV text (pure). */
export function buildPipelineCsv(rows: ExportRow[]): string {
  const header = [
    "Vorname",
    "Nachname",
    "Status",
    "Ort",
    "Quelle",
    "Beratung",
    "Telefon",
    "E-Mail",
    "Erstellt",
    "Aktualisiert",
  ];
  const lines = rows.map((row) =>
    [
      csvCell(row.firstName),
      csvCell(row.lastName),
      csvCell(row.status),
      csvCell(row.city),
      csvCell(row.source),
      csvCell(row.consultantName),
      csvCell(row.phone),
      csvCell(row.email),
      csvCell(row.createdAt.toISOString()),
      csvCell(row.updatedAt.toISOString()),
    ].join(","),
  );
  return [header.join(","), ...lines].join("\r\n");
}
