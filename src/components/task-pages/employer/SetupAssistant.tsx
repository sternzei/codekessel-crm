import type { employers } from "@/db/schema";
import { submitEmployerSetup } from "@/modules/employers/actions";
import { STAFFING_BANDS } from "@/lib/ba-format";

type EmployerRow = typeof employers.$inferSelect;

export interface SetupAssistantProps {
  token: string;
  employer: EmployerRow;
  saved: boolean;
}

/**
 * Employer setup assistant (concept §7): Betriebsnummer → AG-S → contact
 * person → time model. Completed steps collapse to a checkmark; the wizard
 * re-opens at whatever is missing. Partial saves keep the link valid.
 */
export function SetupAssistant({ token, employer, saved }: SetupAssistantProps) {
  const step1Done = Boolean(employer.betriebsnummer);
  const step2Done =
    employer.agsRegistered === false ||
    (employer.agsRegistered === true && Boolean(employer.agsContactName));
  const step3Done = Boolean(employer.contactName && employer.contactEmail);
  const step4Done = employer.timeModelStatus === "yes";
  const step5Done = Boolean(employer.legalForm && employer.iban);
  const staffing = new Map(
    (employer.staffingByHoursBand ?? []).map((b) => [b.band, b.count]),
  );

  return (
    <main className="task-card" style={{ maxWidth: "34rem" }}>
      <span className="kicker">Geförderte Weiterbildung · {employer.companyName}</span>
      <h1>Angaben für die Förderung</h1>
      <p className="intro">
        Für den Förderantrag Ihres Mitarbeiters / Ihrer Mitarbeiterin benötigt
        die Agentur für Arbeit einige Angaben zu Ihrem Unternehmen. Das dauert
        etwa 5 Minuten. Sie können zwischendurch speichern — der Link bleibt
        gültig.
      </p>

      {saved ? (
        <p className="badge badge--ok" style={{ alignSelf: "flex-start" }}>
          Zwischenstand gespeichert — es fehlen noch Angaben.
        </p>
      ) : null}

      <form
        action={submitEmployerSetup}
        style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}
      >
        <input type="hidden" name="token" value={token} />

        <WizardStep n={1} title="Betriebsnummer" done={step1Done}>
          <p className="step-help">
            Die 8-stellige Betriebsnummer vergibt die Bundesagentur für
            Arbeit. Sie steht in jeder Sozialversicherungsmeldung.
          </p>
          <details className="instructions">
            <summary>Wo finde ich die Betriebsnummer?</summary>
            <ul>
              <li>Lohn- und Gehaltsabrechnung (Kopfzeile der SV-Meldungen)</li>
              <li>Lohnbuchhaltung oder Steuerberatung fragen</li>
              <li>Personalabteilung oder Geschäftsführung</li>
              <li>
                Noch keine Betriebsnummer? Sie kann kostenlos beim
                Betriebsnummern-Service der Bundesagentur für Arbeit beantragt
                werden (Firmendaten und Anschrift bereithalten).
              </li>
            </ul>
          </details>
          <div className="field">
            <label htmlFor="betriebsnummer">Betriebsnummer (8-stellig)</label>
            <input
              id="betriebsnummer"
              name="betriebsnummer"
              inputMode="numeric"
              defaultValue={employer.betriebsnummer ?? ""}
              placeholder="z. B. 12345678"
            />
          </div>
        </WizardStep>

        <WizardStep n={2} title="Arbeitgeberservice (AG-S)" done={step2Done}>
          <p className="step-help">
            Der Arbeitgeberservice der Agentur für Arbeit begleitet den
            Förderantrag auf Unternehmensseite.
          </p>
          <details className="instructions">
            <summary>Was ist der Arbeitgeberservice?</summary>
            <ul>
              <li>Kostenlose Ansprechstelle der Agentur für Arbeit für Unternehmen</li>
              <li>Erreichbar unter 0800 4 555520 (gebührenfrei)</li>
              <li>Klärt Fördervoraussetzungen und nimmt den Antrag entgegen</li>
              <li>Halten Sie Betriebsnummer und Firmendaten bereit</li>
            </ul>
          </details>
          <div className="field">
            <label htmlFor="agsRegistered">Sind Sie dort bereits bekannt / registriert?</label>
            <select
              id="agsRegistered"
              name="agsRegistered"
              defaultValue={
                employer.agsRegistered == null
                  ? ""
                  : employer.agsRegistered
                    ? "yes"
                    : "no"
              }
            >
              <option value="">— bitte wählen —</option>
              <option value="yes">Ja, Kontakt besteht</option>
              <option value="no">Nein, noch kein Kontakt</option>
              <option value="unsure">Nicht sicher</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="agsContactName">Ansprechperson beim AG-S (falls bekannt)</label>
            <input
              id="agsContactName"
              name="agsContactName"
              defaultValue={employer.agsContactName ?? ""}
            />
          </div>
          <div className="field">
            <label htmlFor="agsContactEmail">E-Mail der AG-S-Ansprechperson</label>
            <input
              id="agsContactEmail"
              name="agsContactEmail"
              type="email"
              defaultValue={employer.agsContactEmail ?? ""}
            />
          </div>
        </WizardStep>

        <WizardStep n={3} title="Ansprechperson im Unternehmen" done={step3Done}>
          <p className="step-help">
            Wer ist bei Ihnen für den Weiterbildungsantrag zuständig?
          </p>
          <div className="field">
            <label htmlFor="contactName">Name *</label>
            <input
              id="contactName"
              name="contactName"
              defaultValue={employer.contactName ?? ""}
            />
          </div>
          <div className="field">
            <label htmlFor="contactRole">Funktion</label>
            <input
              id="contactRole"
              name="contactRole"
              defaultValue={employer.contactRole ?? ""}
              placeholder="z. B. Personalleitung"
            />
          </div>
          <div className="field">
            <label htmlFor="contactEmail">E-Mail *</label>
            <input
              id="contactEmail"
              name="contactEmail"
              type="email"
              defaultValue={employer.contactEmail ?? ""}
            />
          </div>
          <div className="field">
            <label htmlFor="contactPhone">Telefon</label>
            <input
              id="contactPhone"
              name="contactPhone"
              type="tel"
              defaultValue={employer.contactPhone ?? ""}
            />
          </div>
        </WizardStep>

        <WizardStep n={4} title="Zeitmodell bestätigen" done={step4Done}>
          <p className="step-help">
            Kann Ihr Mitarbeiter / Ihre Mitarbeiterin ca. 20 Stunden pro Woche
            über etwa 6 Monate an der Weiterbildung teilnehmen?
          </p>
          <div className="field">
            <label htmlFor="timeModel">Ihre Einschätzung</label>
            <select
              id="timeModel"
              name="timeModel"
              defaultValue={
                employer.timeModelStatus === "probably_employer_pending"
                  ? "unclear"
                  : employer.timeModelStatus
              }
            >
              <option value="unclear">Muss intern geklärt werden</option>
              <option value="yes">Ja, das ist möglich</option>
              <option value="partial">Nur teilweise möglich</option>
              <option value="not_possible">Aktuell nicht möglich</option>
            </select>
          </div>
        </WizardStep>

        <WizardStep n={5} title="Weitere Angaben für den Antrag" done={step5Done}>
          <p className="step-help">
            Für den Förderantrag benötigt die Agentur für Arbeit einige
            Unternehmensangaben. Alle Felder sind optional — Sie können auch
            später ergänzen.
          </p>
          <div className="field">
            <label htmlFor="legalForm">Rechtsform</label>
            <input
              id="legalForm"
              name="legalForm"
              defaultValue={employer.legalForm ?? ""}
              placeholder="z. B. GmbH"
            />
          </div>
          <div className="field">
            <label htmlFor="iban">IBAN (Geschäftskonto)</label>
            <input id="iban" name="iban" defaultValue={employer.iban ?? ""} />
          </div>
          <div className="field">
            <label htmlFor="bic">BIC</label>
            <input id="bic" name="bic" defaultValue={employer.bic ?? ""} />
          </div>
          <div className="field">
            <label htmlFor="betriebsvereinbarung">
              Gibt es eine Betriebsvereinbarung oder einen Tarifvertrag zur
              Weiterbildung?
            </label>
            <select
              id="betriebsvereinbarung"
              name="betriebsvereinbarung"
              defaultValue={
                employer.hasBetriebsvereinbarung == null
                  ? ""
                  : employer.hasBetriebsvereinbarung
                    ? "yes"
                    : "no"
              }
            >
              <option value="">— bitte wählen —</option>
              <option value="yes">Ja</option>
              <option value="no">Nein</option>
            </select>
          </div>
          <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
            <legend style={{ fontSize: "var(--text-sm)", fontWeight: 600 }}>
              Beschäftigte nach Wochenarbeitszeit
            </legend>
            {STAFFING_BANDS.map((band) => (
              <div className="field" key={band.key}>
                <label htmlFor={`staffing_${band.key}`}>{band.label}</label>
                <input
                  id={`staffing_${band.key}`}
                  name={`staffing_${band.key}`}
                  inputMode="numeric"
                  defaultValue={staffing.get(band.key)?.toString() ?? ""}
                />
              </div>
            ))}
          </fieldset>
        </WizardStep>

        <button type="submit" className="button">
          Angaben speichern
        </button>
        <p style={{ fontSize: "var(--text-xs)", color: "var(--color-ink-faint)" }}>
          Ihre Angaben werden ausschließlich für den Förderantrag verwendet.
        </p>
      </form>
    </main>
  );
}

function WizardStep({
  n,
  title,
  done,
  children,
}: {
  n: number;
  title: string;
  done: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="wizard-step" data-done={done} aria-label={`Schritt ${n}: ${title}`}>
      <header>
        <span className="num">{done ? "✓" : n}</span>
        <h2>{title}</h2>
        {done ? <span className="badge badge--ok">erledigt</span> : null}
      </header>
      <div className="wizard-step-body">{children}</div>
    </section>
  );
}
