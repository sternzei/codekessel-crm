import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { withTenant } from "@/db/client";
import { getSession } from "@/modules/auth/session";
import {
  getLeadDetail,
  LEAD_ACTIVITY_MAX,
  LEAD_ACTIVITY_PAGE_SIZE,
  listEmployerOptions,
  listMeasureOptions,
  type LeadDetail,
} from "@/modules/participants/detail";
import {
  addContactNote,
  assignLeads,
  inviteAptitudeTest,
  requestConsentLink,
  requestUploadLink,
  scheduleAppointment,
  setAptitudeTestStatus,
  setAvailability,
  setLeadStatus,
  undoLastAction,
  updateEligibility,
  updateParticipantBaData,
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
  searchParams: Promise<{
    gate?: string;
    undo?: string;
    transition?: string;
    badata?: string;
    consentLink?: string;
    uploadLink?: string;
    access?: "must_claim" | "forbidden";
    assignment?: "saved" | "forbidden";
    activityLimit?: string;
    aptitude?: string;
  }>;
}) {
  const session = await getSession();
  if (!session) redirect("/auth/sign-in");

  const { id } = await params;
  const {
    gate,
    undo,
    transition,
    badata,
    consentLink,
    uploadLink,
    access,
    assignment,
    activityLimit: activityLimitRaw,
    aptitude,
  } =
    await searchParams;
  const tStatus = await getTranslations("status.participant");
  const tActivity = await getTranslations("activity");
  const parsedActivityLimit = Number.parseInt(activityLimitRaw ?? "", 10);
  const activityLimit = Number.isFinite(parsedActivityLimit)
    ? Math.min(
        Math.max(LEAD_ACTIVITY_PAGE_SIZE, parsedActivityLimit),
        LEAD_ACTIVITY_MAX,
      )
    : LEAD_ACTIVITY_PAGE_SIZE;

  const data = await withTenant(session.tenantId, async (tx) => {
    const detail = await getLeadDetail(
      tx,
      id,
      {
        userId: session.id,
        role: session.role,
      },
      { activityLimit },
    );
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

      {access || assignment === "forbidden" ? (
        <p
          className="gate-banner"
          role="alert"
          style={{ marginBottom: "var(--space-6)" }}
        >
          {access === "must_claim"
            ? "Bitte übernehmen Sie diesen Lead, bevor Sie Daten oder Aufgaben bearbeiten."
            : "Sie dürfen diesen Lead nicht ändern oder einer anderen Beratung zuweisen."}
        </p>
      ) : null}

      {session.role === "consultant" && p.assignedConsultantId === null ? (
        <form
          action={assignLeads}
          className="info-banner"
          style={{ marginBottom: "var(--space-6)" }}
        >
          <input type="hidden" name="participantId" value={p.id} />
          <input type="hidden" name="consultant" value={session.id} />
          <input type="hidden" name="returnTo" value={`/leads/${p.id}`} />
          <p>
            Dieser Lead ist noch nicht zugewiesen. Übernehmen Sie ihn, bevor Sie
            Änderungen vornehmen.
          </p>
          <button type="submit" className="button button--sm">
            Lead übernehmen
          </button>
        </form>
      ) : null}

      {gate === "1" ? (
        <p className="gate-banner" style={{ marginBottom: "var(--space-6)" }}>
          Statuswechsel blockiert: Die Verfügbarkeit (20 Std./Woche über 6
          Monate) muss eindeutig mit „Ja“ bestätigt sein, bevor der Lead
          qualifiziert werden kann.
        </p>
      ) : null}

      {transition === "1" ? (
        <p className="gate-banner" style={{ marginBottom: "var(--space-6)" }}>
          Statuswechsel blockiert: Dieser Schritt ist im Lead-Funnel nicht
          zulässig. Bitte die Zwischenschritte einhalten oder den Lead als
          „verloren“ markieren.
        </p>
      ) : null}

      {aptitude === "unconfigured" ? (
        <p
          className="gate-banner"
          role="alert"
          style={{ marginBottom: "var(--space-6)" }}
        >
          Eignungstest nicht eingeladen: Es ist keine Test-Adresse hinterlegt
          (APTITUDE_TEST_BASE_URL). Sonst würde die teilnehmende Person einen
          Link ins Leere erhalten.
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

      {badata === "saved" ? (
        <p className="info-banner" style={{ marginBottom: "var(--space-6)" }}>
          BA-Antragsdaten gespeichert.
        </p>
      ) : null}

      {consentLink ? (
        <p className="info-banner" style={{ marginBottom: "var(--space-6)" }}>
          Einwilligungs-Link erzeugt:{" "}
          <a href={consentLink} target="_blank" rel="noreferrer">
            {consentLink}
          </a>
        </p>
      ) : null}

      {uploadLink ? (
        <p className="info-banner" style={{ marginBottom: "var(--space-6)" }}>
          Upload-Link erzeugt:{" "}
          <a href={uploadLink} target="_blank" rel="noreferrer">
            {uploadLink}
          </a>
        </p>
      ) : null}
      {badata === "iban" || badata === "bic" || badata === "sv" ? (
        <p className="gate-banner" style={{ marginBottom: "var(--space-6)" }}>
          {badata === "iban"
            ? "Die IBAN ist ungültig (Prüfsumme). Bitte korrigieren."
            : badata === "bic"
              ? "Der BIC hat kein gültiges Format (8 oder 11 Zeichen)."
              : "Die Sozialversicherungsnummer hat kein gültiges Format."}{" "}
          Die übrigen Angaben wurden nicht gespeichert.
        </p>
      ) : null}

      <div className="detail-grid">
        {/* ─── Left column: call script + eligibility + notes ─── */}
        <div className="section-stack">
          <CallScript participantId={p.id} />

          <section className="section" aria-label="Fördervoraussetzungen">
            <h2>Fördervoraussetzungen</h2>
            <RegisterFinancials participant={p} />
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

          <BaDataSection participant={p} />

          <section className="section" aria-label="Einwilligungen">
            <h2>Einwilligungen (DSGVO)</h2>
            <p style={{ fontSize: "var(--text-xs)", color: "var(--color-ink-faint)" }}>
              Vom Teilnehmer benötigt: Datenschutz- und Kontakt-Einwilligung
              (Pflicht für den Antrag). Der Link öffnet den externen
              Einwilligungs-Task.
            </p>
            <form action={requestConsentLink}>
              <input type="hidden" name="participantId" value={p.id} />
              <button type="submit" className="button button--sm">
                Einwilligungs-Link erzeugen
              </button>
            </form>
          </section>

          <section className="section" aria-label="Unterlagen">
            <h2>Unterlagen (Nachweise)</h2>
            <p style={{ fontSize: "var(--text-xs)", color: "var(--color-ink-faint)" }}>
              Vom Teilnehmer benötigt: Nachweise für den Antrag (PDF, JPG oder
              PNG, max. 10&nbsp;MB pro Datei). Der Link öffnet den externen
              Upload-Task.
            </p>
            <form action={requestUploadLink}>
              <input type="hidden" name="participantId" value={p.id} />
              <button type="submit" className="button button--sm">
                Upload-Link erzeugen
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

          <section className="section" aria-label={tActivity("title")}>
            <h2>{tActivity("title")}</h2>
            {data.activity.length === 0 ? (
              <p className="empty-state">{tActivity("empty")}</p>
            ) : (
              <ul className="timeline" style={{ margin: 0, padding: 0 }}>
                {data.activity.map((entry) => {
                  const label = tActivity.has(`events.${entry.event}`)
                    ? tActivity(`events.${entry.event}`)
                    : entry.event;
                  const actorLabel =
                    entry.actorName ??
                    (entry.actorKind === "system"
                      ? tActivity("system")
                      : null);
                  const statusMeta =
                    entry.meta &&
                    typeof entry.meta === "object" &&
                    "status" in entry.meta
                      ? ` → ${(entry.meta as { status?: string }).status}`
                      : "";
                  // A send without provider credentials is logged as
                  // "gesendet" too, so say which one this was.
                  const isSimulated =
                    entry.meta !== null &&
                    typeof entry.meta === "object" &&
                    (entry.meta as { mode?: string }).mode === "mock";
                  return (
                    <li key={entry.id}>
                      <span className="event">{label}</span>
                      {statusMeta}
                      {isSimulated ? ` (${tActivity("simulated")})` : ""}
                      {actorLabel
                        ? ` · ${tActivity("by", { name: actorLabel })}`
                        : ""}{" "}
                      · {fmtDateTime(entry.createdAt)}
                    </li>
                  );
                })}
              </ul>
            )}
            {data.activity.length >= activityLimit &&
            activityLimit < LEAD_ACTIVITY_MAX ? (
              <p style={{ marginTop: "var(--space-3)" }}>
                <Link
                  href={`/leads/${id}?activityLimit=${Math.min(
                    activityLimit + LEAD_ACTIVITY_PAGE_SIZE,
                    LEAD_ACTIVITY_MAX,
                  )}`}
                  className="button button--sm button--ghost"
                  aria-label={tActivity("loadMore")}
                >
                  {tActivity("loadMore")}
                </Link>
              </p>
            ) : null}
          </section>
        </div>
      </div>
    </>
  );
}

const FINANCIALS_SOURCE_LABEL: Record<string, string> = {
  indicators: "Kennzahlen (Register)",
  search_row: "Suchergebnis (Register)",
};

/**
 * Read-only structured financial provenance carried over from the OpenRegister
 * import (net income / reporting year / source). Renders nothing when the lead
 * has no persisted figures — a missing value is shown as "—", never as 0.
 */
function RegisterFinancials({
  participant: p,
}: {
  participant: LeadDetail["participant"];
}) {
  const hasFinancials =
    p.netIncome != null ||
    p.financialYear != null ||
    p.financialsSource != null;
  if (!hasFinancials) return null;
  const netIncomeText =
    p.netIncome != null
      ? `${Math.round(Number(p.netIncome)).toLocaleString("de-DE")} €`
      : "—";
  const sourceText = p.financialsSource
    ? (FINANCIALS_SOURCE_LABEL[p.financialsSource] ?? p.financialsSource)
    : null;
  return (
    <p
      className="meta"
      style={{ display: "block", marginBottom: "var(--space-3)" }}
    >
      Register-Finanzdaten: Jahresergebnis {netIncomeText}
      {p.financialYear != null ? ` · GJ ${p.financialYear}` : ""}
      {sourceText ? ` · Quelle: ${sourceText}` : ""}
    </p>
  );
}

const WEEKDAYS = [
  ["mon", "Mo"],
  ["tue", "Di"],
  ["wed", "Mi"],
  ["thu", "Do"],
  ["fri", "Fr"],
  ["sat", "Sa"],
  ["sun", "So"],
] as const;

function BaDataSection({
  participant: p,
}: {
  participant: LeadDetail["participant"];
}) {
  const qual = p.qualificationHistory?.[0];
  const funding = p.fundingStatus;
  const components = p.salaryComponents ?? [];

  return (
    <section className="section" aria-label="BA-Antragsdaten">
      <h2>BA-Antragsdaten</h2>
      <p style={{ fontSize: "var(--text-xs)", color: "var(--color-ink-faint)" }}>
        Angaben für die BA-Formulare (SV-Nummer, Bankdaten, Gehalt,
        Arbeits-/Schulungszeiten, Berufsabschluss, Förderstatus).
      </p>
      <form
        action={updateParticipantBaData}
        style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}
      >
        <input type="hidden" name="participantId" value={p.id} />
        <div className="field">
          <label htmlFor="svNumber">Sozialversicherungsnummer</label>
          <input
            id="svNumber"
            name="svNumber"
            defaultValue={p.svNumber ?? ""}
            placeholder="z. B. 15070649C103"
          />
        </div>
        <div className="inline-form">
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="iban">IBAN (Person)</label>
            <input id="iban" name="iban" defaultValue={p.iban ?? ""} />
          </div>
          <div className="field" style={{ width: "9rem" }}>
            <label htmlFor="bic">BIC</label>
            <input id="bic" name="bic" defaultValue={p.bic ?? ""} />
          </div>
        </div>
        <div className="inline-form">
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="monthlyGrossSalary">Monatl. Bruttogehalt (EUR)</label>
            <input
              id="monthlyGrossSalary"
              name="monthlyGrossSalary"
              inputMode="decimal"
              defaultValue={p.monthlyGrossSalary ?? ""}
            />
          </div>
          <div className="field" style={{ width: "8rem" }}>
            <label htmlFor="weeklyWorkingHours">Std./Woche</label>
            <input
              id="weeklyWorkingHours"
              name="weeklyWorkingHours"
              inputMode="decimal"
              defaultValue={p.weeklyWorkingHours ?? ""}
            />
          </div>
          <div className="field" style={{ width: "8rem" }}>
            <label htmlFor="monthlyWorkingHours">Std./Monat</label>
            <input
              id="monthlyWorkingHours"
              name="monthlyWorkingHours"
              inputMode="decimal"
              defaultValue={p.monthlyWorkingHours ?? ""}
            />
          </div>
          <div className="field" style={{ width: "10rem" }}>
            <label htmlFor="freistellungsstunden">Freistellung (Std.)</label>
            <input
              id="freistellungsstunden"
              name="freistellungsstunden"
              inputMode="decimal"
              defaultValue={p.freistellungsstunden ?? ""}
            />
          </div>
        </div>

        <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
          <legend style={{ fontSize: "var(--text-sm)", fontWeight: 600 }}>
            Vergütungsbestandteile
          </legend>
          {[0, 1, 2].map((i) => (
            <div className="inline-form" key={i}>
              <div className="field" style={{ flex: 1 }}>
                <label htmlFor={`salaryLabel${i}`}>Bezeichnung</label>
                <input
                  id={`salaryLabel${i}`}
                  name={`salaryLabel${i}`}
                  defaultValue={components[i]?.label ?? ""}
                />
              </div>
              <div className="field" style={{ width: "8rem" }}>
                <label htmlFor={`salaryAmount${i}`}>Betrag (EUR)</label>
                <input
                  id={`salaryAmount${i}`}
                  name={`salaryAmount${i}`}
                  inputMode="decimal"
                  defaultValue={components[i] ? String(components[i].amountEur) : ""}
                />
              </div>
            </div>
          ))}
        </fieldset>

        <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
          <legend style={{ fontSize: "var(--text-sm)", fontWeight: 600 }}>
            Schulungszeiten (Uhrzeiten je Wochentag)
          </legend>
          {WEEKDAYS.map(([key, label]) => (
            <div className="inline-form" key={key}>
              <span
                style={{
                  width: "2.5rem",
                  alignSelf: "center",
                  fontSize: "var(--text-sm)",
                }}
              >
                {label}
              </span>
              <div className="field" style={{ width: "8rem" }}>
                <label htmlFor={`schulung_${key}_from`}>von</label>
                <input
                  id={`schulung_${key}_from`}
                  name={`schulung_${key}_from`}
                  type="time"
                  defaultValue={p.schulungszeiten?.[key]?.from ?? ""}
                />
              </div>
              <div className="field" style={{ width: "8rem" }}>
                <label htmlFor={`schulung_${key}_to`}>bis</label>
                <input
                  id={`schulung_${key}_to`}
                  name={`schulung_${key}_to`}
                  type="time"
                  defaultValue={p.schulungszeiten?.[key]?.to ?? ""}
                />
              </div>
            </div>
          ))}
        </fieldset>

        <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
          <legend style={{ fontSize: "var(--text-sm)", fontWeight: 600 }}>
            Berufsabschluss
          </legend>
          <div className="field">
            <label htmlFor="qualBeruf">Berufsbezeichnung</label>
            <input id="qualBeruf" name="qualBeruf" defaultValue={qual?.beruf ?? ""} />
          </div>
          <div className="inline-form">
            <div className="field" style={{ width: "11rem" }}>
              <label htmlFor="qualAbschlussdatum">Zeugnisdatum</label>
              <input
                id="qualAbschlussdatum"
                name="qualAbschlussdatum"
                type="date"
                defaultValue={qual?.abschlussdatum ?? ""}
              />
            </div>
            <div className="field" style={{ width: "11rem" }}>
              <label htmlFor="qualAusbildungVon">Ausbildung von</label>
              <input
                id="qualAusbildungVon"
                name="qualAusbildungVon"
                type="date"
                defaultValue={qual?.ausbildungVon ?? ""}
              />
            </div>
            <div className="field" style={{ width: "11rem" }}>
              <label htmlFor="qualAusbildungBis">Ausbildung bis</label>
              <input
                id="qualAusbildungBis"
                name="qualAusbildungBis"
                type="date"
                defaultValue={qual?.ausbildungBis ?? ""}
              />
            </div>
          </div>
        </fieldset>

        <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
          <legend style={{ fontSize: "var(--text-sm)", fontWeight: 600 }}>
            Förderstatus
          </legend>
          <label className="checkbox-row">
            <input
              type="checkbox"
              name="fundingKug"
              defaultChecked={Boolean(funding?.kug)}
            />
            Kurzarbeitergeld (KuG)
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              name="fundingEgz"
              defaultChecked={Boolean(funding?.egz)}
            />
            Eingliederungszuschuss (EGZ)
          </label>
          <div className="field">
            <label htmlFor="fundingOther">Sonstige Förderung</label>
            <input
              id="fundingOther"
              name="fundingOther"
              defaultValue={funding?.other ?? ""}
            />
          </div>
        </fieldset>

        <button type="submit" className="button button--sm">
          BA-Antragsdaten speichern
        </button>
      </form>
    </section>
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
