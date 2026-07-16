import { startAptitudeTest } from "@/modules/aptitude-tests/actions";

export interface StartAptitudeTestProps {
  token: string;
  participantFirstName: string;
}

export function StartAptitudeTest({
  token,
  participantFirstName,
}: StartAptitudeTestProps) {
  return (
    <main className="task-card">
      <span className="kicker">Geförderte Weiterbildung</span>
      <h1>Eignungstest starten</h1>
      <p className="intro">
        Hallo {participantFirstName}, der Eignungstest soll Sie nicht
        ausschließen — er hilft uns einzuschätzen, ob die Weiterbildung in
        Ihrer aktuellen Situation realistisch und passend ist. Er dauert etwa
        30 Minuten und kann unterbrochen werden.
      </p>
      <form action={startAptitudeTest}>
        <input type="hidden" name="token" value={token} />
        <button type="submit" className="button" style={{ width: "100%" }}>
          Test jetzt starten
        </button>
      </form>
      <p style={{ fontSize: "var(--text-xs)", color: "var(--color-ink-faint)" }}>
        Sie können über denselben Link zurückkehren, falls Sie unterbrochen
        werden.
      </p>
    </main>
  );
}
