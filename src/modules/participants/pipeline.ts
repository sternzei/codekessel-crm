import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";
import type { DbHandle } from "@/db/client";
import { employers, importRuns, participants, users } from "@/db/schema";
import {
  buildPipelineConditions,
  type ExportRow,
  type PipelineFilter,
  type PipelineListParams,
  type StatusCounts,
} from "./pipeline-filter";
import type { ParticipantStatus } from "./queries";

// ---------------------------------------------------------------------------
// DB-access layer for the pipeline workspace. Every count is computed with an
// aggregated SQL query (never by loading rows into JS), and the list query is
// server-side paginated + sorted. All access runs inside withTenant (RLS), so
// tenant boundaries are enforced by the database, not by these queries.
// The aggregate and list queries share buildPipelineConditions, so a KPI count
// and the corresponding list can never disagree.
// ---------------------------------------------------------------------------

const EXPORT_ROW_LIMIT = 10_000;

/** Grouped GROUP BY status counts for the current filter. */
export async function aggregateByStatus(
  tx: DbHandle,
  filter: PipelineFilter,
): Promise<StatusCounts> {
  const conditions = buildPipelineConditions(filter);
  const rows = await tx
    .select({
      status: participants.status,
      count: sql<number>`count(*)::int`,
    })
    .from(participants)
    .where(and(...conditions))
    .groupBy(participants.status);
  const counts: StatusCounts = {};
  for (const row of rows) counts[row.status] = row.count;
  return counts;
}

export interface CoverageResult {
  total: number;
  withPhone: number;
  withEmail: number;
}

/** Total + contactability coverage counts for the current filter. */
export async function aggregateCoverage(
  tx: DbHandle,
  filter: PipelineFilter,
): Promise<CoverageResult> {
  const conditions = buildPipelineConditions(filter);
  const [row] = await tx
    .select({
      total: sql<number>`count(*)::int`,
      withPhone: sql<number>`count(*) filter (where ${participants.phoneNormalized} is not null and ${participants.phoneNormalized} <> '')::int`,
      withEmail: sql<number>`count(*) filter (where ${participants.email} is not null and ${participants.email} <> '')::int`,
    })
    .from(participants)
    .where(and(...conditions));
  return {
    total: row?.total ?? 0,
    withPhone: row?.withPhone ?? 0,
    withEmail: row?.withEmail ?? 0,
  };
}

export interface PipelineAlerts {
  staleNew: number;
  missingPhone: number;
  missingEmail: number;
  wrongNumber: number;
  employerPending: number;
}

/**
 * Tenant-wide bottleneck counts. Each corresponds exactly to a focused URL
 * filter the UI links to (so the alert count always equals the resulting
 * list). `staleCutoff` must match the `createdUntil` used in the stale-lead
 * link so both sides apply the identical predicate.
 */
export async function getPipelineAlerts(
  tx: DbHandle,
  staleCutoff: Date,
): Promise<PipelineAlerts> {
  // Bind the cutoff as an explicitly-cast timestamptz string: inside a raw
  // FILTER expression there is no column context for postgres.js to infer the
  // parameter type from, so a bare Date param fails to bind.
  const staleCutoffIso = staleCutoff.toISOString();
  const [row] = await tx
    .select({
      staleNew: sql<number>`count(*) filter (where ${participants.status} = 'new' and ${participants.createdAt} <= ${staleCutoffIso}::timestamptz)::int`,
      missingPhone: sql<number>`count(*) filter (where ${participants.phoneNormalized} is null or ${participants.phoneNormalized} = '')::int`,
      missingEmail: sql<number>`count(*) filter (where ${participants.email} is null or ${participants.email} = '')::int`,
      wrongNumber: sql<number>`count(*) filter (where ${participants.status} = 'wrong_number')::int`,
      employerPending: sql<number>`count(*) filter (where ${participants.status} = 'employer_pending')::int`,
    })
    .from(participants);
  return {
    staleNew: row?.staleNew ?? 0,
    missingPhone: row?.missingPhone ?? 0,
    missingEmail: row?.missingEmail ?? 0,
    wrongNumber: row?.wrongNumber ?? 0,
    employerPending: row?.employerPending ?? 0,
  };
}

export interface ImportFreshness {
  lastCompletedAt: Date | null;
  lastStats: Record<string, unknown> | null;
  running: number;
  failed: number;
}

/**
 * Import-run freshness for the data strip. import_runs may be empty (the
 * current OpenRegister import writes leads directly), so every field falls
 * back gracefully.
 */
export async function getImportFreshness(
  tx: DbHandle,
): Promise<ImportFreshness> {
  const [last] = await tx
    .select({ finishedAt: importRuns.finishedAt, stats: importRuns.stats })
    .from(importRuns)
    .where(eq(importRuns.status, "completed"))
    .orderBy(desc(importRuns.finishedAt))
    .limit(1);
  const [counts] = await tx
    .select({
      running: sql<number>`count(*) filter (where ${importRuns.status} = 'running')::int`,
      failed: sql<number>`count(*) filter (where ${importRuns.status} = 'failed')::int`,
    })
    .from(importRuns);
  return {
    lastCompletedAt: last?.finishedAt ?? null,
    lastStats: (last?.stats as Record<string, unknown> | null) ?? null,
    running: counts?.running ?? 0,
    failed: counts?.failed ?? 0,
  };
}

export interface PipelineRow {
  id: string;
  firstName: string;
  lastName: string;
  status: ParticipantStatus;
  availabilityStatus: string;
  city: string | null;
  source: string | null;
  email: string | null;
  phone: string | null;
  hasPhone: boolean;
  hasEmail: boolean;
  consultantId: string | null;
  consultantName: string | null;
  employerName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PipelinePage {
  rows: PipelineRow[];
  total: number;
}

function orderBy(params: PipelineListParams): SQL[] {
  const dir = params.dir === "asc" ? asc : desc;
  switch (params.sort) {
    case "name":
      return [dir(participants.lastName), dir(participants.firstName)];
    case "updated":
      return [dir(participants.updatedAt)];
    case "status":
      return [dir(participants.status)];
    case "created":
    default:
      return [dir(participants.createdAt)];
  }
}

const rowSelection = {
  id: participants.id,
  firstName: participants.firstName,
  lastName: participants.lastName,
  status: participants.status,
  availabilityStatus: participants.availabilityStatus,
  city: participants.city,
  source: participants.source,
  email: participants.email,
  phone: participants.phone,
  phoneNormalized: participants.phoneNormalized,
  consultantId: participants.assignedConsultantId,
  consultantName: users.name,
  employerName: employers.companyName,
  createdAt: participants.createdAt,
  updatedAt: participants.updatedAt,
} as const;

type RawRow = {
  id: string;
  firstName: string;
  lastName: string;
  status: ParticipantStatus;
  availabilityStatus: string;
  city: string | null;
  source: string | null;
  email: string | null;
  phone: string | null;
  phoneNormalized: string | null;
  consultantId: string | null;
  consultantName: string | null;
  employerName: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function toPipelineRow(row: RawRow): PipelineRow {
  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    status: row.status,
    availabilityStatus: row.availabilityStatus,
    city: row.city,
    source: row.source,
    email: row.email,
    phone: row.phone,
    hasPhone: Boolean(row.phoneNormalized && row.phoneNormalized.length > 0),
    hasEmail: Boolean(row.email && row.email.length > 0),
    consultantId: row.consultantId,
    consultantName: row.consultantName,
    employerName: row.employerName,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Paginated + sorted lead list for the current filter (shares conditions). */
export async function listPipelinePage(
  tx: DbHandle,
  params: PipelineListParams,
): Promise<PipelinePage> {
  const conditions = buildPipelineConditions(params.filter);
  const whereExpr = and(...conditions);
  const [totalRow] = await tx
    .select({ total: sql<number>`count(*)::int` })
    .from(participants)
    .where(whereExpr);
  const rows = await tx
    .select(rowSelection)
    .from(participants)
    .leftJoin(users, eq(participants.assignedConsultantId, users.id))
    .leftJoin(employers, eq(participants.employerId, employers.id))
    .where(whereExpr)
    .orderBy(...orderBy(params))
    .limit(params.pageSize)
    .offset((params.page - 1) * params.pageSize);
  return {
    rows: rows.map(toPipelineRow),
    total: totalRow?.total ?? 0,
  };
}

/** Full (unpaginated, capped) filtered result set for CSV export. */
export async function listPipelineForExport(
  tx: DbHandle,
  filter: PipelineFilter,
): Promise<ExportRow[]> {
  const conditions = buildPipelineConditions(filter);
  const rows = await tx
    .select({
      firstName: participants.firstName,
      lastName: participants.lastName,
      status: participants.status,
      city: participants.city,
      source: participants.source,
      consultantName: users.name,
      phone: participants.phone,
      email: participants.email,
      createdAt: participants.createdAt,
      updatedAt: participants.updatedAt,
    })
    .from(participants)
    .leftJoin(users, eq(participants.assignedConsultantId, users.id))
    .where(and(...conditions))
    .orderBy(desc(participants.createdAt))
    .limit(EXPORT_ROW_LIMIT);
  return rows;
}

export interface ConsultantOption {
  id: string;
  name: string;
  role: string;
}

/** Active internal users, for the consultant filter + bulk-assign menu. */
export async function listConsultants(
  tx: DbHandle,
): Promise<ConsultantOption[]> {
  return tx
    .select({ id: users.id, name: users.name, role: users.role })
    .from(users)
    .where(eq(users.active, true))
    .orderBy(asc(users.name));
}

/** Distinct lead sources present in the tenant, for the source filter. */
export async function listSources(tx: DbHandle): Promise<string[]> {
  const rows = await tx
    .selectDistinct({ source: participants.source })
    .from(participants)
    .where(sql`${participants.source} is not null and ${participants.source} <> ''`)
    .orderBy(asc(participants.source));
  return rows.map((r) => r.source).filter((s): s is string => Boolean(s));
}
