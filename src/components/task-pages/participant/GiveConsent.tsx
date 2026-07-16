import { giveConsent } from "@/modules/participants/external-actions";

export function GiveConsent({
  token,
  participantFirstName,
}: {
  token: string;
  participantFirstName: string;
}) {
  return (
    <main className="task-card">
      <span className="kicker">Geförderte Weiterbildung</span>
      <h1>Einwilligungen</h1>
      <p className="intro">
        Hallo {participantFirstName}, damit wir Ihren Förderantrag vorbereiten
        dürfen, benötigen wir Ihre Einwilligung. (PLATZHALTER — finale
        Rechtstexte folgen nach juristischer Prüfung.)
      </p>
      <form
        action={giveConsent}
        style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}
      >
        <input type="hidden" name="token" value={token} />
        <fieldset className="choice-group">
          <label className="choice">
            <input type="checkbox" name="privacy" required />
            <span>
              Ich habe die <strong>Datenschutzerklärung</strong> gelesen und
              willige in die Verarbeitung meiner Daten zur Antragsvorbereitung
              ein. * (PLATZHALTER)
            </span>
          </label>
          <label className="choice">
            <input type="checkbox" name="contact" required />
            <span>
              Ich willige ein, zu diesem Vorgang <strong>kontaktiert</strong>{" "}
              zu werden (Telefon, E-Mail). * (PLATZHALTER)
            </span>
          </label>
          <label className="choice">
            <input type="checkbox" name="whatsapp" />
            <span>
              Ich möchte Erinnerungen zusätzlich per <strong>WhatsApp</strong>{" "}
              erhalten. (optional)
            </span>
          </label>
        </fieldset>
        <button type="submit" className="button">
          Einwilligungen bestätigen
        </button>
        <p style={{ fontSize: "var(--text-xs)", color: "var(--color-ink-faint)" }}>
          Zeitpunkt, IP-Adresse und Textversion werden für den Nachweis
          gespeichert. Ein Widerruf ist jederzeit möglich.
        </p>
      </form>
    </main>
  );
}
