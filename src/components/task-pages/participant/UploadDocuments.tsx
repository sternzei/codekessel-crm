import { uploadDocuments } from "@/modules/participants/external-actions";

export function UploadDocuments({
  token,
  participantFirstName,
}: {
  token: string;
  participantFirstName: string;
}) {
  return (
    <main className="task-card">
      <span className="kicker">Geförderte Weiterbildung</span>
      <h1>Unterlagen hochladen</h1>
      <p className="intro">
        Hallo {participantFirstName}, bitte laden Sie die angeforderten
        Unterlagen hoch (PDF, JPG oder PNG, max. 10&nbsp;MB pro Datei).
      </p>
      <form
        action={uploadDocuments}
        style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}
      >
        <input type="hidden" name="token" value={token} />
        <div className="field">
          <label htmlFor="files">Dateien auswählen</label>
          <input
            id="files"
            name="files"
            type="file"
            multiple
            required
            accept="application/pdf,image/jpeg,image/png"
          />
        </div>
        <button type="submit" className="button">
          Hochladen
        </button>
      </form>
    </main>
  );
}
