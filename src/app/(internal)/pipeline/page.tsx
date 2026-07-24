import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { PipelineFilters } from "@/components/internal/PipelineFilters";
import {
  PipelineTable,
  type PipelineRowView,
} from "@/components/internal/PipelineTable";
import { RefreshButton } from "@/components/internal/RefreshButton";
import { withTenant } from "@/db/client";
import { getSession } from "@/modules/auth/session";
import {
  aggregateByStatus,
  aggregateCoverage,
  getImportFreshness,
  getPipelineAlerts,
  listConsultants,
  listImportRuns,
  listPipelinePage,
  listSources,
  type ImportRunSummary,
} from "@/modules/participants/pipeline";
import {
  buildFunnel,
  buildPresetQuery,
  computeConversions,
  deriveKpis,
  isPresetActive,
  nextActionKey,
  parsePipelineListParams,
  PIPELINE_PRESETS,
  STALE_NEW_DAYS,
  type ConversionKey,
  type NextActionKey,
} from "@/modules/participants/pipeline-filter";
import { PIPELINE_STATUS_ORDER, type ParticipantStatus } from "@/modules/participants/queries";

export const dynamic = "force-dynamic";

type RawSearchParams = Record<string, string | string[] | undefined>;
type BadgeTone = "ok" | "warn" | "danger" | "neutral";

const dateFmt = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin",
  dateStyle: "medium",
});
const dateTimeFmt = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin",
  dateStyle: "medium",
  timeStyle: "short",
});

const STATUS_TONE: Record<ParticipantStatus, BadgeTone> = {
  new: "neutral",
  called: "neutral",
  not_reachable: "danger",
  wrong_number: "danger",
  interested: "ok",
  not_interested: "danger",
  eligibility_unclear: "warn",
  employer_pending: "warn",
  qualified: "ok",
  test_phase: "ok",
  documents_phase: "ok",
  application_phase: "ok",
  enrolled: "ok",
  lost: "danger",
};

const NEXT_ACTION_LABEL: Record<NextActionKey, string> = {
  call: "Erstkontakt anrufen",
  log_outcome: "Ergebnis erfassen",
  retry_call: "Erneut anrufen",
  fix_number: "Nummer korrigieren",
  qualify: "Qualifizieren",
  clarify_eligibility: "Förderung klären",
  follow_employer: "Arbeitgeber nachfassen",
  invite_test: "Zum Test einladen",
  track_test: "Test verfolgen",
  collect_docs: "Dokumente einsammeln",
  track_application: "Antrag verfolgen",
  none: "—",
};

const CONVERSION_LABEL: Record<ConversionKey, string> = {
  worked: "Erstkontakt",
  reached: "Erreicht",
  qualified: "Qualifiziert",
  application: "Antrag",
  enrolled: "Eingeschrieben",
};

const IMPORT_MESSAGES: Record<string, string> = {
  inserted: "Lead aus dem Register importiert.",
  updated: "Bestehender Lead aus dem Register aktualisiert.",
  skipped: "Lead war bereits vorhanden — nichts zu aktualisieren.",
  conflicted:
    "Lead existiert bereits, aber mit einem anderen Arbeitgeber verknüpft — bitte prüfen.",
};

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function buildQuery(
  sp: RawSearchParams,
  opts: { set?: Record<string, string>; drop?: string[] } = {},
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (opts.drop?.includes(key)) continue;
    if (Array.isArray(value)) value.forEach((v) => params.append(key, v));
    else if (value != null) params.append(key, value);
  }
  if (opts.set) for (const [k, v] of Object.entries(opts.set)) params.set(k, v);
  return params.toString();
}

function toDateInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function fmtRate(value: number | null): string {
  return value === null ? "—" : `${value} %`;
}

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const session = await getSession();
  if (!session) redirect("/auth/sign-in");

  const sp = await searchParams;
  const listParams = parsePipelineListParams(sp);
  const { filter, page, pageSize, sort, dir } = listParams;

  // Stale-lead cutoff: end of the day STALE_NEW_DAYS ago. The alert query and
  // the alert's link both use this exact instant so their counts agree.
  const staleCutoffDate = new Date();
  staleCutoffDate.setDate(staleCutoffDate.getDate() - STALE_NEW_DAYS);
  const staleUntil = toDateInput(staleCutoffDate);
  const staleCutoff = new Date(staleCutoffDate);
  staleCutoff.setHours(23, 59, 59, 999);

  const data = await withTenant(session.tenantId, async (tx) => {
    const [
      counts,
      coverage,
      listPage,
      alerts,
      freshness,
      importRuns,
      consultants,
      sources,
    ] = await Promise.all([
      aggregateByStatus(tx, filter),
      aggregateCoverage(tx, filter),
      listPipelinePage(tx, listParams),
      getPipelineAlerts(tx, staleCutoff),
      getImportFreshness(tx),
      listImportRuns(tx),
      listConsultants(tx),
      listSources(tx),
    ]);
    return {
      counts,
      coverage,
      listPage,
      alerts,
      freshness,
      importRuns,
      consultants,
      sources,
    };
  });

  // "Alle" (clear) is active only when no filter constraint is set.
  const isFilterEmpty =
    filter.statuses.length === 0 &&
    !filter.consultantId &&
    !filter.unassigned &&
    !filter.source &&
    !filter.phone &&
    !filter.email &&
    !filter.search &&
    !filter.createdFrom &&
    !filter.createdUntil;

  const kpis = deriveKpis(data.counts, data.coverage);
  const funnel = buildFunnel(data.counts);
  const conversions = computeConversions(data.counts);
  const funnelMax = Math.max(1, ...funnel.map((stage) => stage.count));

  const t = await getTranslations("pipeline");
  const tStatus = await getTranslations("status.participant");
  const statusLabels: Record<string, string> = {};
  for (const status of PIPELINE_STATUS_ORDER) statusLabels[status] = tStatus(status);

  const rows: PipelineRowView[] = data.listPage.rows.map((row) => ({
    id: row.id,
    name: `${row.firstName} ${row.lastName}`.trim(),
    subtitle:
      [row.employerName, row.city].filter(Boolean).join(" · ") || "—",
    statusLabel: statusLabels[row.status] ?? row.status,
    statusTone: STATUS_TONE[row.status],
    consultantName: row.consultantName,
    source: row.source,
    hasPhone: row.hasPhone,
    hasEmail: row.hasEmail,
    createdLabel: dateFmt.format(row.createdAt),
    updatedLabel: dateFmt.format(row.updatedAt),
    nextActionLabel: NEXT_ACTION_LABEL[nextActionKey(row.status)],
  }));

  const importOutcome = first(sp.import);
  const importedCount = Number(first(sp.imported));
  const importMessage = importOutcome ? IMPORT_MESSAGES[importOutcome] : undefined;
  const forbidden = first(sp.forbidden) === "1";

  const dateRangeLabel =
    filter.createdFrom || filter.createdUntil
      ? `${filter.createdFrom ? dateFmt.format(filter.createdFrom) : "…"} – ${
          filter.createdUntil ? dateFmt.format(filter.createdUntil) : "…"
        }`
      : "gesamter Zeitraum";
  const denom = `von ${kpis.total} · ${dateRangeLabel}`;

  const totalPages = Math.max(1, Math.ceil(data.listPage.total / pageSize));
  const rangeStart = data.listPage.total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, data.listPage.total);

  const exportHref = `/api/pipeline/export?${buildQuery(sp, {
    drop: ["page", "pageSize", "sort", "dir"],
  })}`;

  const alertItems = [
    {
      key: "staleNew",
      count: data.alerts.staleNew,
      label: `Neue Leads älter als ${STALE_NEW_DAYS} Tage`,
      href: `/pipeline?status=new&createdUntil=${staleUntil}`,
    },
    {
      key: "employerPending",
      count: data.alerts.employerPending,
      label: "Warten auf Arbeitgeber-Freigabe",
      href: "/pipeline?status=employer_pending",
    },
    {
      key: "wrongNumber",
      count: data.alerts.wrongNumber,
      label: "Falsche Telefonnummer",
      href: "/pipeline?status=wrong_number",
    },
    {
      key: "missingPhone",
      count: data.alerts.missingPhone,
      label: "Ohne Telefonnummer",
      href: "/pipeline?phone=without",
    },
    {
      key: "missingEmail",
      count: data.alerts.missingEmail,
      label: "Ohne E-Mail",
      href: "/pipeline?email=without",
    },
  ].filter((item) => item.count > 0);

  return (
    <>
      <header
        className="page-header"
        style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: "var(--space-4)", flexWrap: "wrap" }}
      >
        <div>
          <h1>{t("title")}</h1>
          <p>{t("subtitle")}</p>
        </div>
        <div className="quick-actions">
          <Link href="/leads/new" className="button button--sm">
            + Neuer Lead
          </Link>
          {session.role === "admin" ? (
            <Link href="/leads/import" className="button button--sm button--ghost">
              Register-Import
            </Link>
          ) : null}
          <RefreshButton />
          <a href={exportHref} className="button button--sm button--ghost" download>
            Export (CSV)
          </a>
        </div>
      </header>

      {importedCount > 0 ? (
        <p className="info-banner" style={{ marginBottom: "var(--space-4)" }}>
          {importedCount} Lead(s) aus dem Register importiert.
        </p>
      ) : null}
      {importMessage ? (
        <p
          className={importOutcome === "conflicted" ? "gate-banner" : "info-banner"}
          style={{ marginBottom: "var(--space-4)" }}
        >
          {importMessage}
        </p>
      ) : null}
      {forbidden ? (
        <p className="gate-banner" style={{ marginBottom: "var(--space-4)" }}>
          Kein Zugriff: Der Register-Import ist der Verwaltung vorbehalten.
        </p>
      ) : null}

      <div className="pipeline-strip" role="status">
        <span>
          <strong>{data.listPage.total}</strong> Leads im aktuellen Filter
        </span>
        <span>
          Letzter Import:{" "}
          {data.freshness.lastCompletedAt
            ? dateTimeFmt.format(data.freshness.lastCompletedAt)
            : "noch nicht erfasst"}
        </span>
        {data.freshness.running > 0 ? (
          <span className="pipeline-strip-run">
            {data.freshness.running} Import läuft …
          </span>
        ) : null}
        {data.freshness.failed > 0 ? (
          <Link href="/leads/import" className="pipeline-strip-fail">
            {data.freshness.failed} fehlgeschlagene Importe
          </Link>
        ) : null}
      </div>

      <ImportRunHistory runs={data.importRuns} fmt={dateTimeFmt} />

      <section className="section" aria-label="Kennzahlen" style={{ marginTop: "var(--space-6)" }}>
        <h2>Operative Kennzahlen · {dateRangeLabel}</h2>
        <div className="kpi-grid">
          <Kpi label="Leads gesamt" value={kpis.total} hint="alle Leads im Filter" />
          <Kpi
            label="Erstkontakt offen"
            value={kpis.needsFirstCall}
            tone="warn"
            hint={`Status „neu“ · ${denom}`}
          />
          <Kpi
            label="Erreicht"
            value={kpis.reached}
            suffix={fmtRate(kpis.reachedRate)}
            tone="ok"
            hint={`${kpis.reached} ${denom} · echtes Gespräch`}
          />
          <Kpi
            label="Interessiert"
            value={kpis.interested}
            tone="ok"
            hint={`Status „interessiert“ · ${denom}`}
          />
          <Kpi
            label="Qualifiziert+"
            value={kpis.qualifiedPlus}
            suffix={fmtRate(kpis.qualifiedRate)}
            hint={`${kpis.qualifiedPlus} ${denom} · Verfügbarkeit bestätigt`}
          />
          <Kpi
            label="Arbeitgeber offen"
            value={kpis.employerPending}
            tone="warn"
            hint={`wartet auf AG-Freigabe · ${denom}`}
          />
          <Kpi
            label="Nicht erreichbar"
            value={kpis.unreachable}
            tone="danger"
            hint={`nicht erreichbar + falsche Nr. · ${denom}`}
          />
          <Kpi
            label="In Antrag"
            value={kpis.applicationPlus}
            hint={`Antrag + eingeschrieben · ${denom}`}
          />
        </div>
      </section>

      <section className="section" aria-label="Kontaktierbarkeit">
        <h2>Kontaktierbarkeit</h2>
        <div className="kpi-grid">
          <Kpi
            label="Telefon-Abdeckung"
            value={kpis.withPhone}
            suffix={fmtRate(kpis.phoneCoverage)}
            tone={kpis.phoneCoverage !== null && kpis.phoneCoverage < 80 ? "warn" : "ok"}
            hint={`${kpis.withPhone} ${denom} mit Telefonnummer`}
          />
          <Kpi
            label="E-Mail-Abdeckung"
            value={kpis.withEmail}
            suffix={fmtRate(kpis.emailCoverage)}
            tone={kpis.emailCoverage !== null && kpis.emailCoverage < 50 ? "warn" : "ok"}
            hint={`${kpis.withEmail} ${denom} mit E-Mail`}
          />
          <Kpi label="Offen in Bearbeitung" value={kpis.open} hint="ohne verloren/abgelehnt/eingeschrieben" />
          <Kpi
            label="Verloren"
            value={kpis.lost}
            suffix={fmtRate(kpis.lostRate)}
            tone="danger"
            hint={`verloren + kein Interesse · ${denom}`}
          />
        </div>
      </section>

      <section className="section" aria-label="Funnel">
        <h2>Funnel &amp; Konversion</h2>
        <div className="pipeline-conversions">
          {conversions.map((step) => (
            <div key={step.key} className="pipeline-conversion" title={`${step.numerator} / ${step.denominator}`}>
              <span className="pipeline-conversion-rate">{fmtRate(step.rate)}</span>
              <span className="pipeline-conversion-label">{CONVERSION_LABEL[step.key]}</span>
              <span className="pipeline-conversion-frac">
                {step.numerator}/{step.denominator}
              </span>
            </div>
          ))}
        </div>
        <div className="funnel">
          {funnel.map((stage) => (
            <Link
              key={stage.status}
              href={`/pipeline?status=${stage.status}`}
              className="funnel-row"
              data-empty={stage.count === 0}
              style={{ color: "inherit" }}
            >
              <span className="funnel-label">{statusLabels[stage.status]}</span>
              <span className="funnel-bar-track">
                <span
                  className="funnel-bar"
                  style={{ width: `${(stage.count / funnelMax) * 100}%` }}
                />
              </span>
              <span className="funnel-count">{stage.count}</span>
            </Link>
          ))}
        </div>
      </section>

      {alertItems.length > 0 ? (
        <section className="section" aria-label="Engpässe">
          <h2>Engpässe &amp; Handlungsbedarf</h2>
          <div className="pipeline-alerts">
            {alertItems.map((item) => (
              <Link key={item.key} href={item.href} className="pipeline-alert">
                <span className="pipeline-alert-count">{item.count}</span>
                <span>{item.label}</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section className="section" aria-label="Schnellfilter">
        <h2>Schnellfilter</h2>
        <div className="quick-actions">
          <Link
            href="/pipeline"
            className={`button button--sm${isFilterEmpty ? "" : " button--ghost"}`}
          >
            Alle
          </Link>
          {PIPELINE_PRESETS.map((preset) => {
            const active = isPresetActive(preset, filter);
            return (
              <Link
                key={preset.key}
                href={`/pipeline?${buildPresetQuery(preset)}`}
                className={`button button--sm${active ? "" : " button--ghost"}`}
                title={preset.description}
                aria-current={active ? "true" : undefined}
              >
                {preset.label}
              </Link>
            );
          })}
        </div>
      </section>

      <PipelineFilters
        statuses={PIPELINE_STATUS_ORDER}
        statusLabels={statusLabels}
        consultants={data.consultants}
        sources={data.sources}
        current={{
          status: filter.statuses,
          consultant: filter.unassigned
            ? "unassigned"
            : filter.consultantId ?? "",
          source: filter.source ?? "",
          createdFrom: first(sp.createdFrom),
          createdUntil: first(sp.createdUntil),
          phone: filter.phone ?? "",
          email: filter.email ?? "",
          q: filter.search ?? "",
          sort,
          dir,
        }}
      />

      {data.listPage.total === 0 ? (
        <div className="empty-state">{t("empty")}</div>
      ) : (
        <>
          <PipelineTable
            rows={rows}
            consultants={data.consultants}
            sort={sort}
            dir={dir}
          />
          <div className="pipeline-pager">
            <span>
              {rangeStart}–{rangeEnd} von {data.listPage.total}
            </span>
            <div className="quick-actions">
              {page > 1 ? (
                <Link
                  href={`/pipeline?${buildQuery(sp, { set: { page: String(page - 1) } })}`}
                  className="button button--sm button--ghost"
                >
                  ← Zurück
                </Link>
              ) : null}
              <span className="pipeline-pager-info">
                Seite {page}/{totalPages}
              </span>
              {page < totalPages ? (
                <Link
                  href={`/pipeline?${buildQuery(sp, { set: { page: String(page + 1) } })}`}
                  className="button button--sm button--ghost"
                >
                  Weiter →
                </Link>
              ) : null}
            </div>
          </div>
        </>
      )}
    </>
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
  tone?: BadgeTone;
}) {
  const toneClass = tone && tone !== "neutral" ? ` kpi-card--${tone}` : "";
  return (
    <div className={`kpi-card${toneClass}`} title={hint}>
      <div className="kpi-value">
        {value}
        {suffix ? <span className="kpi-suffix">{suffix}</span> : null}
      </div>
      <div className="kpi-label">{label}</div>
      {hint ? <div className="kpi-hint">{hint}</div> : null}
    </div>
  );
}

const RUN_STATUS_META: Record<string, { label: string; tone: BadgeTone }> = {
  running: { label: "läuft", tone: "warn" },
  completed: { label: "abgeschlossen", tone: "ok" },
  failed: { label: "fehlgeschlagen", tone: "danger" },
};

// Only the honest counters, in a stable order, are surfaced — whatever the run
// actually recorded (single-company runs omit discovered/failed).
const RUN_STAT_LABELS: Array<[string, string]> = [
  ["discovered", "entdeckt"],
  ["inserted", "neu"],
  ["updated", "aktualisiert"],
  ["skipped", "übersprungen"],
  ["conflicted", "Konflikt"],
  ["failed", "fehlgeschlagen"],
];

function formatRunStats(stats: Record<string, unknown> | null): string {
  if (!stats) return "—";
  const parts = RUN_STAT_LABELS.filter(
    ([key]) => typeof stats[key] === "number",
  ).map(([key, label]) => `${label}: ${stats[key] as number}`);
  return parts.length > 0 ? parts.join(" · ") : "—";
}

function ImportRunHistory({
  runs,
  fmt,
}: {
  runs: ImportRunSummary[];
  fmt: Intl.DateTimeFormat;
}) {
  if (runs.length === 0) return null;
  return (
    <section
      className="section"
      aria-label="Import- & Anreicherungsläufe"
      style={{ marginTop: "var(--space-4)" }}
      data-testid="import-run-history"
    >
      <h2>Import- &amp; Anreicherungsläufe</h2>
      <ul className="timeline" style={{ margin: 0, padding: 0 }}>
        {runs.map((run) => {
          const meta = RUN_STATUS_META[run.status] ?? {
            label: run.status,
            tone: "neutral" as BadgeTone,
          };
          const badgeClass =
            meta.tone === "neutral" ? "badge" : `badge badge--${meta.tone}`;
          return (
            <li key={run.id} style={{ marginBottom: "var(--space-2)" }}>
              <span className={badgeClass}>{meta.label}</span>{" "}
              <strong>{run.source}</strong>
              <span className="meta"> · {run.startedByName ?? "System"}</span>
              <div className="meta">
                {fmt.format(run.startedAt)}
                {run.finishedAt ? ` → ${fmt.format(run.finishedAt)}` : ""}
              </div>
              <div className="meta">{formatRunStats(run.stats)}</div>
              {run.status === "failed" && run.error ? (
                <div className="meta pipeline-strip-fail">Fehler: {run.error}</div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
