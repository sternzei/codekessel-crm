import { confirmSubmission } from "@/modules/applications/external-actions";

export function ConfirmSubmission({
  token,
  companyName,
}: {
  token: string;
  companyName: string;
}) {
  return (
    <main className="task-card">
      <span className="kicker">Geförderte Weiterbildung · {companyName}</span>
      <h1>Einreichung bestätigen</h1>
      <p className="intro">
        Bitte bestätigen Sie, dass der Förderantrag beim Arbeitgeberservice
        der Agentur für Arbeit eingereicht wurde. Danach verfolgen wir die
        Rückmeldung für Sie nach.
      </p>
      <form
        action={confirmSubmission}
        style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}
      >
        <input type="hidden" name="token" value={token} />
        <label className="choice">
          <input type="checkbox" name="confirmed" required />
          <span>
            Ja, der Antrag wurde beim Arbeitgeberservice eingereicht.
          </span>
        </label>
        <button type="submit" className="button">
          Einreichung bestätigen
        </button>
      </form>
    </main>
  );
}
