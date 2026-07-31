import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { withTenant } from "@/db/client";
import {
  applications,
  documents,
  employers,
  measures,
  participants,
} from "@/db/schema";
import { getSession } from "@/modules/auth/session";
import {
  exportApplicationPackage,
  setApplicationStatus,
} from "@/modules/applications/actions";
import { computeReadiness } from "@/modules/applications/service";
import { fmtDateTime } from "../leads/[id]/labels";

export const dynamic = "force-dynamic";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATUS: Record<string, { label: string; cls: string }> = {
  in_preparation: { label: "In Vorbereitung", cls: "badge" },
  complete: { label: "Vollständig", cls: "badge badge--ok" },
  sent_to_employer: { label: "Beim Arbeitgeber", cls: "badge badge--warn" },
  submitted: { label: "Eingereicht", cls: "badge badge--warn" },
  response_pending: { label: "Antwort ausstehend", cls: "badge badge--warn" },
  approved: { label: "Bewilligt", cls: "badge badge--ok" },
  rejected: { label: "Abgelehnt", cls: "badge badge--danger" },
  correction_required: { label: "Korrektur nötig", cls: "badge badge--danger" },
};

export default async function ApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ exported?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/auth/sign-in");

  const params = await searchParams;
  // Only ever set by the export action; anything else in the URL is ignored so
  // it can never be reflected into the download link.
  const exported = UUID_PATTERN.test(params.exported ?? "") ? params.exported : null;

  const rows = await withTenant(session.tenantId, async (tx) => {
    const apps = await tx
      .select({
        application: applications,
        participantId: participants.id,
        firstName: participants.firstName,
        lastName: participants.lastName,
        companyName: employers.companyName,
        measureName: measures.name,
      })
      .from(applications)
      .innerJoin(participants, eq(applications.participantId, participants.id))
      .leftJoin(employers, eq(applications.employerId, employers.id))
      .leftJoin(measures, eq(applications.measureId, measures.id))
      .orderBy(desc(applications.createdAt));

    const packages = await tx
      .select({ id: documents.id, applicationId: documents.applicationId })
      .from(documents)
      .where(eq(documents.type, "application_package"));
    const packageByApp = new Map(packages.map((p) => [p.applicationId, p.id]));

    // Submission readiness gate (Phase 6): for in_preparation applications,
    // resolve the structural blockers so the UI can disable the "complete"
    // action and show what is still missing.
    const prepApps = apps.filter(
      (r) => r.application.status === "in_preparation",
    );
    const blockerByApp = new Map<string, string[]>();
    await Promise.all(
      prepApps.map(async (r) => {
        const { blockers } = await computeReadiness(tx, {
          participantId: r.application.participantId,
        });
        if (blockers.length) blockerByApp.set(r.application.id, blockers.map((b) => b.label));
      }),
    );

    return apps.map((row) => ({
      ...row,
      packageDocId: packageByApp.get(row.application.id) ?? null,
      blockers: blockerByApp.get(row.application.id) ?? null,
    }));
  });

  return (
    <>
      <header className="page-header">
        <h1>Anträge</h1>
        <p>
          Vorbereitung → Paket-Export → Arbeitgeber-Bestätigung → Einreichung →
          Rückmeldung. Anträge werden auf der Dokumente-Seite eines Leads
          angelegt.
        </p>
      </header>

      {exported ? (
        <p
          className="info-banner"
          role="status"
          style={{ marginBottom: "var(--space-4)" }}
        >
          Antragspaket erstellt und unter „Dokumente&ldquo; abgelegt.{" "}
          <a
            href={`/api/documents/${exported}/download`}
            target="_blank"
            rel="noreferrer"
          >
            Paket-PDF öffnen
          </a>
        </p>
      ) : null}

      {rows.length === 0 ? (
        <div className="empty-state">
          Noch keine Anträge. Auf „Dokumente&ldquo; einen Lead öffnen und dort den
          Antrag anlegen.
        </div>
      ) : (
        <div className="data-list">
          {rows.map(({ application: app, ...row }) => {
            const badge = STATUS[app.status] ?? { label: app.status, cls: "badge" };
            return (
              <article
                key={app.id}
                className="data-row"
                style={{ gridTemplateColumns: "1fr auto", rowGap: "var(--space-3)" }}
              >
                <div>
                  <div className="title">
                    <Link href={`/documents/${row.participantId}`}>
                      {row.firstName} {row.lastName}
                    </Link>{" "}
                    · {row.companyName ?? "—"}
                  </div>
                  <div className="meta">
                    {row.measureName ?? "—"}
                    {app.submittedAt
                      ? ` · eingereicht ${fmtDateTime(app.submittedAt)}`
                      : ""}
                    {app.responseNote ? ` · ${app.responseNote}` : ""}
                  </div>
                </div>
                <span style={{ justifySelf: "end", display: "flex", gap: "var(--space-2)" }}>
                  <span className="badge">
                    {app.applicantType === "company"
                      ? "Sammelantrag (Firma)"
                      : "Einzelantrag"}
                  </span>
                  <span className={badge.cls}>{badge.label}</span>
                </span>

                <div className="quick-actions" style={{ gridColumn: "1 / -1" }}>
                  {app.status === "in_preparation" ? (
                    row.blockers && row.blockers.length > 0 ? (
                      <p
                        className="meta"
                        style={{ color: "var(--color-danger)" }}
                      >
                        Vervollständigung blockiert: {row.blockers.join(", ")}
                      </p>
                    ) : (
                      <StatusButton
                        applicationId={app.id}
                        to="complete"
                        label="Als vollständig markieren"
                      />
                    )
                  ) : null}
                  {app.status === "complete" ? (
                    <>
                      <form action={exportApplicationPackage}>
                        <input type="hidden" name="applicationId" value={app.id} />
                        <button type="submit" className="button button--sm">
                          Antragspaket exportieren
                        </button>
                      </form>
                      <StatusButton
                        applicationId={app.id}
                        to="sent_to_employer"
                        label="An Arbeitgeber senden"
                        ghost
                      />
                    </>
                  ) : null}
                  {app.status === "submitted" || app.status === "response_pending" ? (
                    <>
                      <StatusButton applicationId={app.id} to="approved" label="Bewilligt" />
                      <StatusButton
                        applicationId={app.id}
                        to="correction_required"
                        label="Korrektur nötig"
                        ghost
                      />
                      <StatusButton
                        applicationId={app.id}
                        to="rejected"
                        label="Abgelehnt"
                        danger
                      />
                    </>
                  ) : null}
                  {app.status === "correction_required" ? (
                    <StatusButton
                      applicationId={app.id}
                      to="complete"
                      label="Korrektur abgeschlossen"
                    />
                  ) : null}
                  {row.packageDocId ? (
                    <a
                      href={`/api/documents/${row.packageDocId}/download`}
                      target="_blank"
                      rel="noreferrer"
                      className="button button--sm button--ghost"
                    >
                      Paket-PDF öffnen
                    </a>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}

function StatusButton({
  applicationId,
  to,
  label,
  ghost = false,
  danger = false,
}: {
  applicationId: string;
  to: string;
  label: string;
  ghost?: boolean;
  danger?: boolean;
}) {
  const cls = danger ? "button--danger" : ghost ? "button--ghost" : "";
  return (
    <form action={setApplicationStatus}>
      <input type="hidden" name="applicationId" value={applicationId} />
      <input type="hidden" name="status" value={to} />
      <button type="submit" className={`button button--sm ${cls}`}>
        {label}
      </button>
    </form>
  );
}
