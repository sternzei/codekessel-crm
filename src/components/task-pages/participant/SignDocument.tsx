import { signDocument } from "@/modules/signatures/actions";
import { SignaturePadField } from "./SignaturePadField";

export interface SignDocumentProps {
  token: string;
  documentTitle: string;
  signerDisplayName: string;
}

export function SignDocument({
  token,
  documentTitle,
  signerDisplayName,
}: SignDocumentProps) {
  return (
    <main className="task-card" style={{ maxWidth: "34rem" }}>
      <span className="kicker">Geförderte Weiterbildung</span>
      <h1>Dokument unterschreiben</h1>
      <p className="intro">
        Bitte prüfen Sie das Dokument <strong>{documentTitle}</strong> und
        unterschreiben Sie anschließend direkt hier — auf dem Smartphone am
        besten mit dem Finger.
      </p>

      <a
        href={`/t/${encodeURIComponent(token)}/document`}
        target="_blank"
        rel="noreferrer"
        className="button button--ghost"
      >
        Dokument ansehen (PDF)
      </a>

      <form
        action={signDocument}
        style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}
      >
        <input type="hidden" name="token" value={token} />
        <div className="field">
          <label htmlFor="signerName">Vor- und Nachname</label>
          <input
            id="signerName"
            name="signerName"
            required
            minLength={3}
            defaultValue={signerDisplayName}
          />
        </div>
        <div className="field">
          <label>Unterschrift</label>
          <SignaturePadField inputName="signatureDataUrl" />
        </div>
        <label className="choice">
          <input type="checkbox" name="confirmed" required />
          <span>
            Ich bestätige, dass ich das Dokument gelesen habe und die
            Unterschrift von mir stammt.
          </span>
        </label>
        <button type="submit" className="button">
          Jetzt unterschreiben
        </button>
        <p style={{ fontSize: "var(--text-xs)", color: "var(--color-ink-faint)" }}>
          Zum Nachweis werden Name, Zeitpunkt, IP-Adresse und der
          Dokument-Fingerabdruck (SHA-256) gespeichert.
        </p>
      </form>
    </main>
  );
}
