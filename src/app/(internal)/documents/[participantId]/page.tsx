import Link from "next/link";
import { eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { withTenant } from "@/db/client";
import { signatures } from "@/db/schema";
import { getSession } from "@/modules/auth/session";
import { generateDocument, requestSignature } from "@/modules/documents/actions";
import { createApplication } from "@/modules/applications/actions";
import { buildChecklist, collectApplicationData } from "@/modules/documents/data";
import {
  canRequestCanvasSignature,
  pendingQesSigners,
} from "@/modules/signatures/requirements";
import {
  evaluateUploadSet,
  resolveApplicantType,
} from "@/modules/applications/upload-set";
import { fmtDateTime } from "../../leads/[id]/labels";

export const dynamic = "force-dynamic";

const DOC_STATUS: Record<string, { label: string; cls: string }> = {
  data_missing: { label: "Daten fehlen", cls: "badge badge--danger" },
  prefilled: { label: "Vorbefüllt", cls: "badge" },
  reviewed: { label: "Geprüft", cls: "badge" },
  approved: { label: "Freigegeben", cls: "badge badge--ok" },
  sent: { label: "Versendet", cls: "badge badge--warn" },
  submitted: { label: "Eingereicht", cls: "badge badge--warn" },
  partially_signed: { label: "Teilweise signiert", cls: "badge badge--warn" },
  signed: { label: "Signiert", cls: "badge badge--ok" },
};

export default async function DocumentChecklistPage({
  params,
}: {
  params: Promise<{ participantId: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/auth/sign-in");
  const { participantId } = await params;

  const data = await withTenant(session.tenantId, async (tx) => {
    const collected = await collectApplicationData(tx, participantId);
    if (!collected) return null;
    const sigRows = await Promise.all(
      collected.documents.map((d) =>
        tx.select().from(signatures).where(eq(signatures.documentId, d.id)),
      ),
    );
    return { ...collected, sigByDoc: new Map(collected.documents.map((d, i) => [d.id, sigRows[i]])) };
  });
  if (!data) notFound();

  const checklist = buildChecklist(data);
  const p = data.participant;
  const uploadSet = data.application
    ? evaluateUploadSet({
        applicantType: resolveApplicantType(data.application.applicantType),
        documents: data.documents,
        signatures: data.documents.flatMap((d) => data.sigByDoc.get(d.id) ?? []),
      })
    : null;

  return (
    <>
      <header className="page-header">
        <p style={{ marginBottom: "var(--space-1)" }}>
          <Link href="/documents">← Dokumente</Link>
        </p>
        <h1>
          Antragsunterlagen · {p.firstName} {p.lastName}
        </h1>
        <p>
          {data.measure?.name ?? "Keine Maßnahme zugeordnet"} ·{" "}
          {data.employer?.companyName ?? "kein Arbeitgeber"}
        </p>
      </header>

      <div className="detail-grid">
        <div className="section-stack">
          <section className="section" aria-label="Checkliste">
            <h2>Checkliste vor Einreichung</h2>
            <div className="checklist">
              {checklist.map((item) => (
                <div key={item.label} className="checklist-item" data-state={item.state}>
                  <span className="dot" aria-hidden />
                  <span style={{ flex: 1 }}>{item.label}</span>
                  {item.hint ? (
                    <span style={{ fontSize: "var(--text-xs)", color: "var(--color-ink-faint)" }}>
                      {item.hint}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          </section>

          {uploadSet ? (
            <section className="section" aria-label="eService-Upload-Set">
              <h2>
                eService-Upload-Set ·{" "}
                {resolveApplicantType(data.application?.applicantType) === "company"
                  ? "Sammelantrag (Firma)"
                  : "Einzelantrag"}
              </h2>
              <p style={{ fontSize: "var(--text-xs)", color: "var(--color-ink-faint)" }}>
                Für die Einreichung erforderliche Uploads samt Signaturstatus.
                Optionale Formulare blockieren die Einreichung nicht.
              </p>
              <div className="checklist">
                {uploadSet.items.map((item) => {
                  const state = !item.present
                    ? "missing"
                    : item.requiresSignature && !item.signed
                      ? "warn"
                      : "ok";
                  const status = !item.present
                    ? "nicht erzeugt"
                    : item.requiresSignature && !item.signed
                      ? item.qesPending
                        ? "QES ausstehend (Anbieter nicht angebunden)"
                        : "Signatur ausstehend"
                      : "vollständig";
                  return (
                    <div key={item.type} className="checklist-item" data-state={state}>
                      <span className="dot" aria-hidden />
                      <span style={{ flex: 1 }}>
                        {item.label}
                        {item.required ? "" : " (optional)"}
                      </span>
                      <span style={{ fontSize: "var(--text-xs)", color: "var(--color-ink-faint)" }}>
                        {status}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}

          <section className="section" aria-label="Einzelantrag">
            <h2>Einzelantrag — BA eService (6 Schritte)</h2>
            <p style={{ fontSize: "var(--text-xs)", color: "var(--color-ink-faint)" }}>
              Die Antragsdaten werden direkt im eService eingegeben (das
              AEZ-Formular entfällt). Upload in Schritt 3: Trägerbescheinigung.
            </p>
            <div className="quick-actions">
              {(
                [
                  ["traegerbescheinigung", "Trägerbescheinigung (BA-Formular)"],
                  ["eservice_single", "eService-Begleitblatt"],
                ] as const
              ).map(([type, label]) => (
                <form key={type} action={generateDocument}>
                  <input type="hidden" name="participantId" value={p.id} />
                  <input type="hidden" name="type" value={type} />
                  <button type="submit" className="button button--sm">
                    {label}
                  </button>
                </form>
              ))}
            </div>
          </section>

          <section className="section" aria-label="Teilnehmerformulare">
            <h2>Teilnehmerformulare (Arbeitnehmer)</h2>
            <p style={{ fontSize: "var(--text-xs)", color: "var(--color-ink-faint)" }}>
              Vom Teilnehmer auszufüllende/zu unterschreibende BA-Formulare.
              Vorbefüllt aus den zentralen Daten; nicht erfasste Angaben bleiben
              leer und werden von Hand ergänzt.
            </p>
            <div className="quick-actions">
              {(
                [
                  ["arbeitnehmererklaerung", "Arbeitnehmererklärung (BA-Formular)"],
                  ["vollmacht", "Vollmacht (BA-Formular)"],
                  ["fragebogen", "Teilnehmer-Fragebogen (BA-Formular)"],
                ] as const
              ).map(([type, label]) => (
                <form key={type} action={generateDocument}>
                  <input type="hidden" name="participantId" value={p.id} />
                  <input type="hidden" name="type" value={type} />
                  <button type="submit" className="button button--sm">
                    {label}
                  </button>
                </form>
              ))}
            </div>
          </section>

          <section className="section" aria-label="Sammelantrag">
            <h2>Sammelantrag (Firma) — BA eService (7 Schritte)</h2>
            <p style={{ fontSize: "var(--text-xs)", color: "var(--color-ink-faint)" }}>
              Ein Antrag für mehrere Beschäftigte desselben Betriebs. Uploads:
              Lehrgangskosten-Nachweis (Schritt 2), Träger- &
              Maßnahmezertifikat (Schritt 3), Teilnehmerliste (Schritt 4). Die
              Liste umfasst automatisch alle Teilnehmenden dieses Arbeitgebers
              mit derselben Maßnahme.
            </p>
            <div className="quick-actions">
              {(
                [
                  ["teilnehmerliste", "Teilnehmerliste (BA-Formular)"],
                  ["cost_overview", "Lehrgangskosten-Nachweis"],
                  ["eservice_company", "eService-Begleitblatt"],
                ] as const
              ).map(([type, label]) => (
                <form key={type} action={generateDocument}>
                  <input type="hidden" name="participantId" value={p.id} />
                  <input type="hidden" name="type" value={type} />
                  <button type="submit" className="button button--sm">
                    {label}
                  </button>
                </form>
              ))}
            </div>
          </section>

          <section className="section" aria-label="Interne Dokumente">
            <h2>Interne Dokumente</h2>
            <div className="quick-actions">
              {(
                [
                  ["participant_form", "Teilnehmer-Stammblatt (Muster)"],
                  ["employer_datasheet", "Arbeitgeber-Datenblatt"],
                ] as const
              ).map(([type, label]) => (
                <form key={type} action={generateDocument}>
                  <input type="hidden" name="participantId" value={p.id} />
                  <input type="hidden" name="type" value={type} />
                  <button type="submit" className="button button--sm button--ghost">
                    {label}
                  </button>
                </form>
              ))}
            </div>
            <p style={{ fontSize: "var(--text-xs)", color: "var(--color-ink-faint)" }}>
              Fehlen Pflichtdaten, wird das Dokument als „Daten fehlen“
              angelegt und automatisch eine Klärungsaufgabe erzeugt.
            </p>
          </section>

          <section className="section" aria-label="Antrag">
            <h2>Antrag</h2>
            {data.application ? (
              <p style={{ fontSize: "var(--text-sm)" }}>
                Antrag vorhanden — Status und Aktionen unter{" "}
                <Link href="/applications">Anträge</Link>.
              </p>
            ) : data.participant.employerId && data.participant.measureId ? (
              <div className="quick-actions">
                <form action={createApplication}>
                  <input type="hidden" name="participantId" value={p.id} />
                  <input type="hidden" name="applicantType" value="single" />
                  <button type="submit" className="button button--sm">
                    Einzelantrag anlegen
                  </button>
                </form>
                <form action={createApplication}>
                  <input type="hidden" name="participantId" value={p.id} />
                  <input type="hidden" name="applicantType" value="company" />
                  <button type="submit" className="button button--sm button--ghost">
                    Sammelantrag (Firma) anlegen
                  </button>
                </form>
              </div>
            ) : (
              <p style={{ fontSize: "var(--text-sm)", color: "var(--color-ink-faint)" }}>
                Arbeitgeber und Maßnahme müssen zugeordnet sein, bevor ein
                Antrag angelegt werden kann.
              </p>
            )}
          </section>
        </div>

        <section className="section" aria-label="Dokumente">
          <h2>Dokumente</h2>
          {data.documents.length === 0 ? (
            <p className="empty-state" style={{ padding: "var(--space-6)" }}>
              Noch keine Dokumente erstellt.
            </p>
          ) : (
            data.documents.map((doc) => {
              const badge = DOC_STATUS[doc.status] ?? { label: doc.status, cls: "badge" };
              const sigs = data.sigByDoc.get(doc.id) ?? [];
              const signerActive = (kind: string) =>
                sigs.some(
                  (s) =>
                    s.signerKind === kind &&
                    (s.status === "pending" || s.status === "signed"),
                );
              // Epic C: only offer the canvas (SES) button for signers the form
              // actually allows; QES-required signers are marked, never offered.
              const canRequest = (kind: "participant" | "employer") =>
                canRequestCanvasSignature(doc.type, kind).allowed;
              const qesPending =
                doc.status !== "signed" && pendingQesSigners(doc.type).length > 0;
              return (
                <div key={doc.id} className="note" style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                    <strong style={{ flex: 1 }}>{doc.title}</strong>
                    <span className={badge.cls}>{badge.label}</span>
                  </div>
                  <p className="meta">
                    {fmtDateTime(doc.createdAt)}
                    {doc.sha256 ? ` · SHA-256 ${doc.sha256.slice(0, 12)}…` : ""}
                  </p>
                  {sigs.map((s) => (
                    <p key={s.id} className="meta">
                      Signatur ({s.signerKind === "participant" ? "Teilnehmer:in" : "Arbeitgeber"}):{" "}
                      {s.status === "signed"
                        ? `✓ ${s.signerName} · ${s.signedAt ? fmtDateTime(s.signedAt) : ""} · IP ${s.ipAddress}`
                        : "ausstehend"}
                    </p>
                  ))}
                  {doc.status === "partially_signed" ? (
                    <p className="meta" role="status">
                      Unterschriften erscheinen im PDF erst, wenn alle angeforderten
                      Parteien unterschrieben haben.
                    </p>
                  ) : null}
                  {doc.status === "signed" && !doc.signedFilePath ? (
                    <p className="meta" role="alert">
                      Als signiert markiert, aber kein signiertes PDF erzeugt
                      (Originaldatei fehlt).
                    </p>
                  ) : null}
                  <div className="quick-actions">
                    {doc.filePath ? (
                      <a
                        href={`/api/documents/${doc.id}/download`}
                        target="_blank"
                        rel="noreferrer"
                        className="button button--sm button--ghost"
                      >
                        {doc.status === "signed" && doc.signedFilePath
                          ? "Signiertes PDF öffnen"
                          : "PDF öffnen"}
                      </a>
                    ) : null}
                    {doc.filePath && doc.status !== "signed" ? (
                      <>
                        {canRequest("participant") && !signerActive("participant") ? (
                          <form action={requestSignature}>
                            <input type="hidden" name="documentId" value={doc.id} />
                            <input type="hidden" name="participantId" value={p.id} />
                            <input type="hidden" name="returnTo" value="documents" />
                            <input type="hidden" name="signerKind" value="participant" />
                            <button type="submit" className="button button--sm">
                              Signatur: Teilnehmer:in
                            </button>
                          </form>
                        ) : null}
                        {doc.employerId && canRequest("employer") && !signerActive("employer") ? (
                          <form action={requestSignature}>
                            <input type="hidden" name="documentId" value={doc.id} />
                            <input type="hidden" name="participantId" value={p.id} />
                            <input type="hidden" name="returnTo" value="documents" />
                            <input type="hidden" name="signerKind" value="employer" />
                            <button type="submit" className="button button--sm button--ghost">
                              Signatur: Arbeitgeber
                            </button>
                          </form>
                        ) : null}
                        {qesPending ? (
                          <span className="badge badge--warn" title="Kein QES-Anbieter angebunden">
                            QES erforderlich — Anbieter nicht angebunden
                          </span>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </div>
              );
            })
          )}
        </section>
      </div>
    </>
  );
}
