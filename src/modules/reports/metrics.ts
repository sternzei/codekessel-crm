import { and, eq, gte, lte, sql } from "drizzle-orm";
import type { DbHandle } from "@/db/client";
import {
  applications,
  appointments,
  aptitudeTests,
  employers,
  participants,
} from "@/db/schema";
import {
  canManageTenantRecords,
  type ParticipantAccessContext,
} from "@/modules/auth/authorization";
import { buildParticipantAccessCondition } from "@/modules/auth/participant-scope";
import { PIPELINE_STATUS_ORDER } from "@/modules/participants/queries";

// Analytics + quality management (concept §17). Every KPI is computed live
// from the entity tables (RLS-scoped by withTenant). The append-only
// activity_log stays the audit source; the reports read current entity state
// because that is what the funnel and rates describe.

export interface ReportFilter {
  from?: Date;
  until?: Date;
  consultantId?: string;
}

export interface FunnelStep {
  status: string;
  label: string;
  count: number;
}

export interface ReportMetrics {
  // Leads (concept §17)
  totalLeads: number;
  contactedLeads: number;
  contactRate: number | null;
  wrongNumberLeads: number;
  wrongNumberRate: number | null;

  // Appointments
  totalAppointments: number;
  noShowAppointments: number;
  noShowRate: number | null;
  followUpTotal: number;
  followUpCompleted: number;
  followUpCompletionRate: number | null;

  // Aptitude tests
  testInvited: number;
  testCompleted: number;
  testCompletionRate: number | null;
  testPassed: number;
  testPassRate: number | null;

  // Employers (tenant-wide; not consultant-owned)
  totalEmployers: number;
  employerConfirmed: number;
  employerApprovalRate: number | null;
  missingBetriebsnummer: number;
  missingBetriebsnummerRate: number | null;
  missingAgs: number;
  missingAgsRate: number | null;

  // Applications
  totalApplications: number;
  applicationsSubmitted: number;
  submissionRate: number | null;
  applicationsApproved: number;
  approvalRate: number | null;
  avgLeadToApplicationDays: number | null;

  // Funnel / drop-off per pipeline step
  funnel: FunnelStep[];
}

// The canonical pipeline order lives in one place (queries.ts, mirrored from
// participantStatus). The reports funnel and the pipeline workspace both read
// it so the two views can never drift apart. "lost" is the last entry and is
// shown as a drop-off sink rather than a forward step.
const PIPELINE_ORDER = PIPELINE_STATUS_ORDER;

const STATUS_LABELS: Record<string, string> = {
  new: "Neuer Lead",
  called: "Angerufen",
  not_reachable: "Nicht erreichbar",
  wrong_number: "Falsche Nummer",
  interested: "Interessiert",
  not_interested: "Kein Interesse",
  eligibility_unclear: "Förderung unklar",
  employer_pending: "Arbeitgeber offen",
  qualified: "Qualifiziert",
  test_phase: "Eignungstest",
  documents_phase: "Dokumente",
  application_phase: "Antrag",
  enrolled: "Eingeschrieben",
  lost: "Verloren",
};

const pct = (n: number, d: number): number | null =>
  d === 0 ? null : Math.round((n / d) * 1000) / 10;

export async function computeReports(
  tx: DbHandle,
  filter: ReportFilter,
  context: ParticipantAccessContext,
): Promise<ReportMetrics> {
  const selectedConsultantId =
    canManageTenantRecords(context.role) ||
    filter.consultantId === context.userId
      ? filter.consultantId
      : undefined;
  const consultant = selectedConsultantId
    ? eq(participants.assignedConsultantId, selectedConsultantId)
    : undefined;
  const participantAccess = buildParticipantAccessCondition(context);

  // ---- Leads -------------------------------------------------------------
  const leadRange = [
    filter.from ? gte(participants.createdAt, filter.from) : undefined,
    filter.until ? lte(participants.createdAt, filter.until) : undefined,
  ];
  // `contacted` here means "worked at least once" (status has moved past
  // `new`). It counts contact *attempts*, not confirmed reach — the pipeline
  // workspace exposes the stricter "reached" definition (a qualifying
  // conversation happened) via modules/participants/pipeline-filter.ts.
  const [lead] = await tx
    .select({
      total: sql<number>`count(*)::int`,
      contacted: sql<number>`count(*) filter (where ${participants.status} <> 'new')::int`,
      wrongNumber: sql<number>`count(*) filter (where ${participants.status} = 'wrong_number')::int`,
    })
    .from(participants)
    .where(and(...leadRange, consultant, participantAccess));

  // ---- Appointments ------------------------------------------------------
  const apptRange = [
    filter.from ? gte(appointments.scheduledAt, filter.from) : undefined,
    filter.until ? lte(appointments.scheduledAt, filter.until) : undefined,
    selectedConsultantId
      ? eq(appointments.consultantId, selectedConsultantId)
      : undefined,
  ];
  const [appt] = await tx
    .select({
      total: sql<number>`count(*)::int`,
      noShow: sql<number>`count(*) filter (where ${appointments.status} = 'no_show')::int`,
      followTotal: sql<number>`count(*) filter (where ${appointments.type} = 'follow_up')::int`,
      followDone: sql<number>`count(*) filter (where ${appointments.type} = 'follow_up' and ${appointments.status} = 'completed')::int`,
    })
    .from(appointments)
    .innerJoin(participants, eq(appointments.participantId, participants.id))
    .where(and(...apptRange, participantAccess));

  // ---- Aptitude tests ----------------------------------------------------
  const testRange = [
    filter.from ? gte(aptitudeTests.invitedAt, filter.from) : undefined,
    filter.until ? lte(aptitudeTests.invitedAt, filter.until) : undefined,
  ];
  // Consultant filter for tests goes through the owning participant.
  const testRows = await tx
        .select({
          total: sql<number>`count(*)::int`,
          completed: sql<number>`count(*) filter (where ${aptitudeTests.status} in ('completed','passed','failed'))::int`,
          passed: sql<number>`count(*) filter (where ${aptitudeTests.status} = 'passed')::int`,
        })
        .from(aptitudeTests)
        .innerJoin(participants, eq(aptitudeTests.participantId, participants.id))
        .where(and(...testRange, consultant, participantAccess));
  const [test] = testRows;

  // ---- Employers (tenant-wide; date-ranged only) -------------------------
  const employerRange = [
    filter.from ? gte(employers.createdAt, filter.from) : undefined,
    filter.until ? lte(employers.createdAt, filter.until) : undefined,
  ];
  const [emp] = canManageTenantRecords(context.role) ? await tx
    .select({
      total: sql<number>`count(*)::int`,
      confirmed: sql<number>`count(*) filter (where ${employers.status} = 'confirmed')::int`,
      missingBnr: sql<number>`count(*) filter (where ${employers.betriebsnummer} is null or ${employers.betriebsnummer} = '')::int`,
      missingAgs: sql<number>`count(*) filter (where ${employers.agsRegistered} is distinct from true)::int`,
    })
    .from(employers)
    .where(and(...employerRange)) : [];

  // ---- Applications (consultant via participant) -------------------------
  const appRange = [
    filter.from ? gte(applications.createdAt, filter.from) : undefined,
    filter.until ? lte(applications.createdAt, filter.until) : undefined,
  ];
  const [app] = await tx
        .select({
          total: sql<number>`count(*)::int`,
          submitted: sql<number>`count(*) filter (where ${applications.status} in ('submitted','response_pending','approved','rejected','correction_required'))::int`,
          approved: sql<number>`count(*) filter (where ${applications.status} = 'approved')::int`,
          avgDays: sql<number>`coalesce(round(avg(extract(epoch from (${applications.createdAt} - ${participants.createdAt})) / 86400)), 0)::float`,
        })
        .from(applications)
        .innerJoin(participants, eq(applications.participantId, participants.id))
        .where(and(...appRange, consultant, participantAccess));

  // ---- Funnel / drop-off -------------------------------------------------
  const funnelRows = await tx
    .select({
      status: participants.status,
      count: sql<number>`count(*)::int`,
    })
    .from(participants)
    .where(and(...leadRange, consultant, participantAccess))
    .groupBy(participants.status);
  const funnelByStatus = new Map(funnelRows.map((r) => [r.status, r.count]));
  const funnel: FunnelStep[] = PIPELINE_ORDER.map((status) => ({
    status,
    label: STATUS_LABELS[status] ?? status,
    count: funnelByStatus.get(status) ?? 0,
  }));

  return {
    totalLeads: lead?.total ?? 0,
    contactedLeads: lead?.contacted ?? 0,
    contactRate: pct(lead?.contacted ?? 0, lead?.total ?? 0),
    wrongNumberLeads: lead?.wrongNumber ?? 0,
    wrongNumberRate: pct(lead?.wrongNumber ?? 0, lead?.total ?? 0),

    totalAppointments: appt?.total ?? 0,
    noShowAppointments: appt?.noShow ?? 0,
    noShowRate: pct(appt?.noShow ?? 0, appt?.total ?? 0),
    followUpTotal: appt?.followTotal ?? 0,
    followUpCompleted: appt?.followDone ?? 0,
    followUpCompletionRate: pct(appt?.followDone ?? 0, appt?.followTotal ?? 0),

    testInvited: test?.total ?? 0,
    testCompleted: test?.completed ?? 0,
    testCompletionRate: pct(test?.completed ?? 0, test?.total ?? 0),
    testPassed: test?.passed ?? 0,
    testPassRate: pct(test?.passed ?? 0, test?.completed ?? 0),

    totalEmployers: emp?.total ?? 0,
    employerConfirmed: emp?.confirmed ?? 0,
    employerApprovalRate: pct(emp?.confirmed ?? 0, emp?.total ?? 0),
    missingBetriebsnummer: emp?.missingBnr ?? 0,
    missingBetriebsnummerRate: pct(emp?.missingBnr ?? 0, emp?.total ?? 0),
    missingAgs: emp?.missingAgs ?? 0,
    missingAgsRate: pct(emp?.missingAgs ?? 0, emp?.total ?? 0),

    totalApplications: app?.total ?? 0,
    applicationsSubmitted: app?.submitted ?? 0,
    submissionRate: pct(app?.submitted ?? 0, app?.total ?? 0),
    applicationsApproved: app?.approved ?? 0,
    approvalRate: pct(app?.approved ?? 0, app?.submitted ?? 0),
    avgLeadToApplicationDays: app?.avgDays ? Number(app.avgDays) : null,

    funnel,
  };
}
