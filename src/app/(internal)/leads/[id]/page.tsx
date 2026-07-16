import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { withTenant } from "@/db/client";
import { getSession } from "@/modules/auth/session";
import {
  getLeadDetail,
  listEmployerOptions,
  listMeasureOptions,
} from "@/modules/participants/detail";
import {
  addContactNote,
  inviteAptitudeTest,
  scheduleAppointment,
  setAptitudeTestStatus,
  setAvailability,
  setLeadStatus,
  undoLastAction,
  updateEligibility,
} from "@/modules/participants/actions-internal";
import { UndoHotkey } from "@/components/internal/UndoHotkey";
import {
  AVAILABILITY_LABEL,
  fmtDateTime,
  PARTICIPANT_STATUSES,
  TEST_STATUS_LABEL,
} from "./labels";

export const dynamic = "force-dynamic";

export default async function LeadDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ gate?: string; undo?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/auth/sign-in");

  const { id } = await params;
  const { gate, undo } = await searchParams;
  const tStatus = await getTranslations("status.participant");

  const data = await withTenant(session.tenantId, async (tx) => {
    const detail = await getLeadDetail(tx, id);
    if (!detail) return null;
    const [employerOptions, measureOptions] = await Promise.all([
      listEmployerOptions(tx),
      listMeasureOptions(tx),
    ]);
    return { ...detail, employerOptions, measureOptions };
  });
  if (!data) notFound();

  const p = data.participant;

  return (
    <>
      <header className="page-header">
        <p style={{ marginBottom: "var(--space-1)" }}>
          <Link href="/pipeline">← Pipeline</Link>
        </p>
        <h1>
          {p.firstName} {p.lastName}{" "}
          <span className="badge" style={{ verticalAlign: "middle" }}>
            {tStatus(p.status)}
          </span>
        </h1>
        <p>
          {p.city ?? "—"} · {p.phone ?? "keine Nummer"} ·{" "}
          {p.email ?? "keine E-Mail"} · Quelle: {p.source ?? "—"}
        </p>
      </header>

      {gate === "1" ? (
        <p className="gate-banner" style={{ marginBottom: "var(--space-6)" }}>
          Statuswechsel blockiert: Die Verfügbarkeit (20 Std./Woche über 6
          Monate) muss eindeutig mit „Ja“ bestätigt sein, bevor der Lead
          qualifiziert werden kann.
        </p>
      ) : null}

      {undo === "status" || undo === "availability" ? (
        <p className="info-banner" style={{ marginBottom: "var(--space-6)" }}>
          {undo === "availability"
            ? "Letzte Verfügbarkeits-Antwort wurde rückgängig gemacht."
            : "Letzter Statuswechsel wurde rückgängig gemacht."}{" "}
          Offene Folgeaufgaben und geplante Erinnerungen dazu wurden storniert.
        </p>
      ) : null}
      {undo === "none" ? (
        <p className="info-banner" style={{ marginBottom: "var(--space-6)" }}>
          Keine Aktion zum Rückgängigmachen vorhanden.
        </p>
      ) : null}

      <div className="detail-grid">
        {/* ─── Left column: call script + eligibility + notes ─── */}
        <div className="section-stack">
          <CallScript participantId={p.id} />

          <section className="section" aria-label="Fördervoraussetzungen">
            <h2>Fördervoraussetzungen</h2>
            <form
              action={updateEligibility}
              style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}
            >
              <input type="hidden" name="participantId" value={p.id} />
              <div className="field">
                <label htmlFor="employmentStatus">Beschäftigungsstatus</label>
                <select
                  id="employmentStatus"
                  name="employmentStatus"
                  defaultValue={p.employmentStatus ?? ""}
                >
                  <option value="">— nicht erfasst —</option>
                  <option value="employed">Sozialversicherungspflichtig beschäftigt</option>
                  <option value="self_employed">Selbstständig</option>
                  <option value="unemployed">Arbeitslos / arbeitssuchend</option>
                  <option value="other">Sonstiges</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="employerId">Arbeitgeber</label>
                <select id="employerId" name="employerId" defaultValue={p.employerId ?? ""}>
                  <option value="">— kein Arbeitgeber erfasst —</option>
                  {data.employerOptions.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.companyName}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="measureId">Gewünschte Maßnahme</label>
                <select id="measureId" name="measureId" defaultValue={p.measureId ?? ""}>
                  <option value="">— noch offen —</option>
                  {data.measureOptions.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="eligibilityNotes">Notizen zur Förderfähigkeit</label>
                <textarea
                  id="eligibilityNotes"
                  name="eligibilityNotes"
                  defaultValue={p.eligibilityNotes ?? ""}
                />
              </div>
              <button type="submit" className="button button--sm">
                Speichern
              </button>
            </form>
          </section>

          <section className="section" aria-label="Kontaktnotizen">
            <h2>Kontaktnotizen</h2>
            <form action={addContactNote} className="inline-form">
              <input type="hidden" name="participantId" value={p.id} />
              <div className="field" style={{ flex: 1, minWidth: "16rem" }}>
                <label htmlFor="note-body">Neue Notiz</label>
                <textarea id="note-body" name="body" required />
              </div>
              <button type="submit" className="button button--sm">
                Notiz speichern
              </button>
            </form>
            {data.notes.length === 0 ? (
              <p className="data-row meta" style={{ display: "block" }}>
                Noch keine Notizen.
              </p>
            ) : (
              data.notes.map((note) => (
                <div key={note.id} className="note">
                  <p>{note.body}</p>
                  <p className="meta">
                    {note.authorName ?? "System"} · {fmtDateTime(note.createdAt)}
                  </p>
                </div>
              ))
            )}
          </section>
        </div>

        {/* ─── Right column: gate, status, appointments, test, activity ─── */}
        <div className="section-stack">
          <section
            className="gate-widget section"
            data-state={p.availabilityStatus}
            aria-label="Verfügbarkeits-Check"
          >
            <h2>Pflicht-Check: 20 Std./Woche über 6 Monate</h2>
            <p style={{ fontSize: "var(--text-sm)", fontWeight: 600 }}>
              {AVAILABILITY_LABEL[p.availabilityStatus]}
            </p>
            <form action={setAvailability} className="inline-form">
              <input type="hidden" name="participantId" value={p.id} />
              <div className="field" style={{ flex: 1 }}>
                <label htmlFor="availability">Antwort erfassen</label>
                <select id="availability" name="availability" defaultValue={p.availabilityStatus}>
                  {Object.entries(AVAILABILITY_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <button type="submit" className="button button--sm">
                Erfassen
              </button>
            </form>
            <p style={{ fontSize: "var(--text-xs)", color: "var(--color-ink-faint)" }}>
              Ohne eindeutiges „Ja“ ist keine Qualifizierung möglich. Jede
              andere Antwort erzeugt automatisch Klärungsaufgaben.
            </p>
          </section>

          <section className="section" aria-label="Status ändern">
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: "var(--space-2)",
              }}
            >
              <h2>Status ändern</h2>
              <UndoHotkey action={undoLastAction} participantId={p.id} />
            </div>
            <form action={setLeadStatus} className="inline-form">
              <input type="hidden" name="participantId" value={p.id} />
              <div className="field" style={{ flex: 1 }}>
                <label htmlFor="status">Neuer Status</label>
                <select id="status" name="status" defaultValue={p.status}>
                  {PARTICIPANT_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {tStatus(s)}
                    </option>
                  ))}
                </select>
              </div>
              <button type="submit" className="button button--sm">
                Übernehmen
              </button>
            </form>
            <p
              style={{
                fontSize: "var(--text-xs)",
                color: "var(--color-ink-faint)",
              }}
            >
              Tipp: Die letzte Aktion (Statuswechsel oder Verfügbarkeits-Antwort)
              lässt sich mit ⌘/Strg + Z rückgängig machen — inkl. Stornierung
              der dadurch ausgelösten Aufgaben.
            </p>
          </section>

          <section className="section" aria-label="Termine">
            <h2>Termine</h2>
            <form
              action={scheduleAppointment}
              style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}
            >
              <input type="hidden" name="participantId" value={p.id} />
              <div className="inline-form">
                <div className="field">
                  <label htmlFor="apt-type">Art</label>
                  <select id="apt-type" name="type" defaultValue="follow_up">
                    <option value="follow_up">Folgetermin</option>
                    <option value="consultation">Beratung</option>
                    <option value="aptitude_test">Eignungstest</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="apt-at">Zeitpunkt</label>
                  <input id="apt-at" name="scheduledAt" type="datetime-local" required />
                </div>
                <button type="submit" className="button button--sm">
                  Termin planen
                </button>
              </div>
            </form>
            {data.appointments.map((apt) => (
              <div key={apt.id} className="note">
                <p>
                  {apt.type === "follow_up"
                    ? "Folgetermin"
                    : apt.type === "consultation"
                      ? "Beratung"
                      : "Eignungstest"}{" "}
                  · {fmtDateTime(apt.scheduledAt)}
                </p>
                <p className="meta">Status: {apt.status}</p>
              </div>
            ))}
          </section>

          <section className="section" aria-label="Eignungstest">
            <h2>Eignungstest</h2>
            {data.tests.length === 0 ? (
              <form action={inviteAptitudeTest}>
                <input type="hidden" name="participantId" value={p.id} />
                <button type="submit" className="button button--sm">
                  Zum Eignungstest einladen
                </button>
              </form>
            ) : (
              data.tests.map((test) => (
                <div key={test.id} className="note">
                  <p>
                    <span className="badge">{TEST_STATUS_LABEL[test.status]}</span>
                  </p>
                  <p className="meta">
                    Eingeladen: {test.invitedAt ? fmtDateTime(test.invitedAt) : "—"}
                    {test.completedAt
                      ? ` · Abgeschlossen: ${fmtDateTime(test.completedAt)}`
                      : ""}
                  </p>
                  {!["passed", "failed"].includes(test.status) ? (
                    <div className="quick-actions" style={{ marginTop: "var(--space-2)" }}>
                      {(
                        [
                          { value: "passed", label: "Bestanden", cls: "" },
                          { value: "failed", label: "Nicht bestanden", cls: "button--danger" },
                          { value: "no_show", label: "No-Show", cls: "button--ghost" },
                        ] as const
                      ).map((o) => (
                        <form key={o.value} action={setAptitudeTestStatus}>
                          <input type="hidden" name="testId" value={test.id} />
                          <input type="hidden" name="status" value={o.value} />
                          <button type="submit" className={`button button--sm ${o.cls}`}>
                            {o.label}
                          </button>
                        </form>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </section>

          <section className="section" aria-label="Verlauf">
            <h2>Verlauf</h2>
            <ul className="timeline" style={{ margin: 0, padding: 0 }}>
              {data.activity.map((entry) => (
                <li key={entry.id}>
                  <span className="event">{entry.event}</span>
                  {entry.meta && "status" in (entry.meta as object)
                    ? ` → ${(entry.meta as { status?: string }).status}`
                    : ""}{" "}
                  · {fmtDateTime(entry.createdAt)}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </>
  );
}

function CallScript({ participantId }: { participantId: string }) {
  const questions = [
    "Ist die Person aktuell sozialversicherungspflichtig beschäftigt?",
    "Gibt es einen Arbeitgeber, der eingebunden werden kann?",
    "Ist der Arbeitgeber grundsätzlich offen für Weiterbildung?",
    "Besteht ein konkreter Qualifizierungsbedarf?",
    "Sind ca. 20 Std./Woche über 6 Monate realistisch? (Pflicht-Check rechts erfassen)",
    "Kann der Arbeitgeber die Freistellung unterstützen?",
    "Ist der Arbeitgeber beim Arbeitgeberservice (AG-S) registriert?",
    "Hat der Arbeitgeber eine Betriebsnummer?",
  ];

  const outcomes = [
    { status: "called", label: "Angerufen", cls: "button--ghost" },
    { status: "interested", label: "Interessiert", cls: "" },
    { status: "not_reachable", label: "Nicht erreicht", cls: "button--ghost" },
    { status: "wrong_number", label: "Falsche Nummer", cls: "button--danger" },
    { status: "eligibility_unclear", label: "Förderung unklar", cls: "button--ghost" },
    { status: "not_interested", label: "Kein Interesse", cls: "button--danger" },
  ] as const;

  return (
    <section className="section" aria-label="Gesprächsleitfaden">
      <h2>Gesprächsleitfaden Erstkontakt</h2>
      <div>
        {questions.map((q, i) => (
          <div key={q} className="script-step">
            <span className="num">{i + 1}</span>
            <span>{q}</span>
          </div>
        ))}
      </div>
      <h2 style={{ marginTop: "var(--space-2)" }}>Gesprächsergebnis</h2>
      <div className="quick-actions">
        {outcomes.map((o) => (
          <form key={o.status} action={setLeadStatus}>
            <input type="hidden" name="participantId" value={participantId} />
            <input type="hidden" name="status" value={o.status} />
            <button type="submit" className={`button button--sm ${o.cls}`}>
              {o.label}
            </button>
          </form>
        ))}
      </div>
      <p style={{ fontSize: "var(--text-xs)", color: "var(--color-ink-faint)" }}>
        Jedes Ergebnis löst automatisch die passenden Folgeaufgaben aus
        (z.&nbsp;B. „Falsche Nummer“ → E-Mail-Aufgabe an Teilnehmer:in).
      </p>
    </section>
  );
}
