import type { participants } from "@/db/schema";
import { updateContactDetails } from "@/modules/participants/external-actions";

type ParticipantRow = typeof participants.$inferSelect;

export function ConfirmDetails({
  token,
  participant,
}: {
  token: string;
  participant: ParticipantRow;
}) {
  return (
    <main className="task-card">
      <span className="kicker">Geförderte Weiterbildung</span>
      <h1>Kontaktdaten aktualisieren</h1>
      <p className="intro">
        Hallo {participant.firstName}, wir konnten Sie leider nicht erreichen.
        Bitte prüfen und korrigieren Sie Ihre Kontaktdaten — Ihre Beratung
        meldet sich dann direkt bei Ihnen.
      </p>
      <form
        action={updateContactDetails}
        style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}
      >
        <input type="hidden" name="token" value={token} />
        <div className="field">
          <label htmlFor="phone">Telefonnummer *</label>
          <input
            id="phone"
            name="phone"
            type="tel"
            required
            defaultValue={participant.phone ?? ""}
          />
        </div>
        <div className="field">
          <label htmlFor="email">E-Mail</label>
          <input
            id="email"
            name="email"
            type="email"
            defaultValue={participant.email ?? ""}
          />
        </div>
        <div className="field">
          <label htmlFor="street">Straße und Hausnummer</label>
          <input id="street" name="street" defaultValue={participant.street ?? ""} />
        </div>
        <div className="inline-form">
          <div className="field" style={{ width: "7rem" }}>
            <label htmlFor="postalCode">PLZ</label>
            <input
              id="postalCode"
              name="postalCode"
              inputMode="numeric"
              defaultValue={participant.postalCode ?? ""}
            />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label htmlFor="city">Ort</label>
            <input id="city" name="city" defaultValue={participant.city ?? ""} />
          </div>
        </div>
        <button type="submit" className="button">
          Daten senden
        </button>
      </form>
    </main>
  );
}
