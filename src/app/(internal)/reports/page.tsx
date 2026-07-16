import { asc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { users } from "@/db/schema";
import { getSession } from "@/modules/auth/session";
import { computeReports, type ReportMetrics } from "@/modules/reports/metrics";

export const dynamic = "force-dynamic";

const filterSchema = z.object({
  from: z.string().optional(),
  until: z.string().optional(),
  consultant: z.string().optional(),
});

function toDate(value: string | undefined, endOfDay = false): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return undefined;
  if (endOfDay) d.setHours(23, 59, 59, 999);
  return d;
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await getSession();
  if (!session) redirect("/auth/sign-in");

  const raw = await searchParams;
  const parsed = filterSchema.parse({
    from: typeof raw.from === "string" ? raw.from : undefined,
    until: typeof raw.until === "string" ? raw.until : undefined,
    consultant: typeof raw.consultant === "string" ? raw.consultant : undefined,
  });
  const from = toDate(parsed.from);
  const until = toDate(parsed.until, true);
  const consultantId =
    parsed.consultant && parsed.consultant !== "all" ? parsed.consultant : undefined;

  const { consultants, metrics } = await withTenant(session.tenantId, async (tx) => {
    const consultants = await tx
      .select({ id: users.id, name: users.name, role: users.role })
      .from(users)
      .where(eq(users.active, true))
      .orderBy(asc(users.name));
    const metrics = await computeReports(tx, { from, until, consultantId });
    return { consultants, metrics };
  });

  return (
    <>
      <header className="page-header">
        <h1>Berichte &amp; Qualitätskennzahlen</h1>
        <p>
          Prozessschwachstellen entlang des Funnels sichtbar machen — No-Show-,
          Drop-off- und Konversionsraten (Konzept §17).
        </p>
      </header>

      <ReportsFilter
        consultants={consultants}
        from={parsed.from ?? ""}
        until={parsed.until ?? ""}
        consultant={consultantId ?? ""}
      />

      <MetricGroup title="Leads">
        <Kpi label="Neue Leads gesamt" value={metrics.totalLeads} />
        <Kpi
          label="Kontaktrate"
          value={metrics.totalLeads}
          suffix={fmtRate(metrics.contactRate)}
          hint={`${metrics.contactedLeads} kontaktiert`}
        />
        <Kpi
          label="Falsche Telefonnummer"
          value={metrics.wrongNumberLeads}
          suffix={fmtRate(metrics.wrongNumberRate)}
        />
      </MetricGroup>

      <MetricGroup title="Termine">
        <Kpi label="Termine gesamt" value={metrics.totalAppointments} />
        <Kpi
          label="No-Show-Rate"
          value={metrics.noShowAppointments}
          suffix={fmtRate(metrics.noShowRate)}
          tone={toneForRate(metrics.noShowRate, true)}
        />
        <Kpi
          label="Folgetermin abgeschlossen"
          value={`${metrics.followUpCompleted}/${metrics.followUpTotal}`}
          suffix={fmtRate(metrics.followUpCompletionRate)}
        />
      </MetricGroup>

      <MetricGroup title="Eignungstest">
        <Kpi label="Eingeladen" value={metrics.testInvited} />
        <Kpi
          label="Abschlussrate"
          value={metrics.testCompleted}
          suffix={fmtRate(metrics.testCompletionRate)}
        />
        <Kpi
          label="Bestehensrate"
          value={metrics.testPassed}
          suffix={fmtRate(metrics.testPassRate)}
        />
      </MetricGroup>

      <MetricGroup title="Arbeitgeber">
        <Kpi label="Arbeitgeber gesamt" value={metrics.totalEmployers} />
        <Kpi
          label="Bestätigungsrate"
          value={metrics.employerConfirmed}
          suffix={fmtRate(metrics.employerApprovalRate)}
        />
        <Kpi
          label="Betriebsnummer fehlt"
          value={metrics.missingBetriebsnummer}
          suffix={fmtRate(metrics.missingBetriebsnummerRate)}
          tone={toneForRate(metrics.missingBetriebsnummerRate, true)}
        />
        <Kpi
          label="AG-S nicht registriert"
          value={metrics.missingAgs}
          suffix={fmtRate(metrics.missingAgsRate)}
          tone={toneForRate(metrics.missingAgsRate, true)}
        />
      </MetricGroup>

      <MetricGroup title="Anträge">
        <Kpi label="Anträge gesamt" value={metrics.totalApplications} />
        <Kpi
          label="Einreichungsquote"
          value={metrics.applicationsSubmitted}
          suffix={fmtRate(metrics.submissionRate)}
        />
        <Kpi
          label="Bewilligungsquote"
          value={metrics.applicationsApproved}
          suffix={fmtRate(metrics.approvalRate)}
        />
        <Kpi
          label="Ø Zeit Lead → Antrag"
          value={
            metrics.avgLeadToApplicationDays !== null
              ? `${metrics.avgLeadToApplicationDays} d`
              : "—"
          }
        />
      </MetricGroup>

      <section className="section" aria-label="Funnel" style={{ marginTop: "var(--space-8)" }}>
        <h2>Drop-off entlang der Pipeline</h2>
        <Funnel metrics={metrics} />
      </section>
    </>
  );
}

function fmtRate(rate: number | null): string {
  return rate === null ? "—" : `${rate} %`;
}

// Higher = bad for "inverse" metrics (no-show, missing data).
function toneForRate(
  rate: number | null,
  inverse = false,
): "ok" | "warn" | "danger" | undefined {
  if (rate === null) return undefined;
  const score = inverse ? rate : 100 - rate;
  if (score >= 50) return "danger";
  if (score >= 20) return "warn";
  return inverse ? "ok" : undefined;
}

function MetricGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="section" aria-label={title}>
      <h2>{title}</h2>
      <div className="kpi-grid">{children}</div>
    </section>
  );
}

function Kpi({
  label,
  value,
  suffix,
  hint,
  tone,
}: {
  label: string;
  value: number | string;
  suffix?: string;
  hint?: string;
  tone?: "ok" | "warn" | "danger";
}) {
  const cls = tone ? ` kpi-card--${tone}` : "";
  return (
    <div className={`kpi-card${cls}`}>
      <div className="kpi-value">
        {value}
        {suffix ? <span className="kpi-suffix">{suffix}</span> : null}
      </div>
      <div className="kpi-label">{label}</div>
      {hint ? <div className="kpi-hint">{hint}</div> : null}
    </div>
  );
}

function Funnel({ metrics }: { metrics: ReportMetrics }) {
  const max = Math.max(1, ...metrics.funnel.map((s) => s.count));
  return (
    <div className="funnel">
      {metrics.funnel.map((step) => (
        <div key={step.status} className="funnel-row" data-empty={step.count === 0}>
          <span className="funnel-label">{step.label}</span>
          <span className="funnel-bar-track">
            <span
              className="funnel-bar"
              style={{ width: `${(step.count / max) * 100}%` }}
            />
          </span>
          <span className="funnel-count">{step.count}</span>
        </div>
      ))}
    </div>
  );
}

function ReportsFilter({
  consultants,
  from,
  until,
  consultant,
}: {
  consultants: { id: string; name: string; role: string }[];
  from: string;
  until: string;
  consultant: string;
}) {
  return (
    <form method="get" className="card reports-filter">
      <label className="reports-field">
        <span>Von</span>
        <input type="date" name="from" defaultValue={from || undefined} />
      </label>
      <label className="reports-field">
        <span>Bis</span>
        <input type="date" name="until" defaultValue={until || undefined} />
      </label>
      <label className="reports-field">
        <span>Beratung</span>
        <select name="consultant" defaultValue={consultant || "all"}>
          <option value="all">Alle</option>
          {consultants.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} {c.role === "admin" ? "(Admin)" : ""}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className="button button--sm">
        Filter anwenden
      </button>
    </form>
  );
}
