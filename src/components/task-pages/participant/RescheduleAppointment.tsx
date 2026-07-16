import { rescheduleAppointment } from "@/modules/participants/external-actions";

export function RescheduleAppointment({
  token,
  participantFirstName,
}: {
  token: string;
  participantFirstName: string;
}) {
  // Past dates are rejected server-side; no client-side min needed.
  return (
    <main className="task-card">
      <span className="kicker">Geförderte Weiterbildung</span>
      <h1>Neuen Termin wählen</h1>
      <p className="intro">
        Hallo {participantFirstName}, Sie haben Ihren letzten Termin verpasst —
        kein Problem. Wählen Sie einfach direkt einen neuen Zeitpunkt, wir
        erinnern Sie rechtzeitig per WhatsApp.
      </p>
      <form
        action={rescheduleAppointment}
        style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}
      >
        <input type="hidden" name="token" value={token} />
        <div className="field">
          <label htmlFor="scheduledAt">Wunschtermin</label>
          <input
            id="scheduledAt"
            name="scheduledAt"
            type="datetime-local"
            required
          />
        </div>
        <button type="submit" className="button">
          Termin verbindlich buchen
        </button>
      </form>
    </main>
  );
}
