"use client";

import { useRef, useState } from "react";
import {
  requestUploadTickets,
  uploadDocuments,
} from "@/modules/participants/external-actions";

// Uploads the files to object storage first and only then tells the server
// about them, so the bytes never have to fit through a request-body limit.
//
// Requires JavaScript, which is why it is only rendered when the storage
// backend can actually presign — see UploadDocuments for the plain form that
// serves everyone else.

const MESSAGES = {
  throttled: "Zu viele Versuche. Bitte warten Sie einen Moment.",
  invalid: "Dieser Link ist nicht mehr gültig.",
  unsupported: "Der Upload ist gerade nicht verfügbar.",
  rejected: "Bitte nur PDF, JPG oder PNG bis 10 MB auswählen.",
  transfer: "Die Übertragung wurde unterbrochen. Bitte erneut versuchen.",
} as const;

type Status = "idle" | "uploading";

export function DirectUploadForm({ token }: { token: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault();
    const files = Array.from(inputRef.current?.files ?? []);
    if (files.length === 0) return;

    setStatus("uploading");
    setError(null);

    const result = await requestUploadTickets({
      token,
      files: files.map((file) => ({
        name: file.name,
        contentType: file.type,
        byteSize: file.size,
      })),
    });

    if (!result.ok) {
      setStatus("idle");
      setError(MESSAGES[result.reason]);
      return;
    }

    const submitted = new FormData();
    submitted.set("token", token);
    try {
      // One grant per accepted file, in the order they were sent.
      await Promise.all(
        result.grants.map(async (grant, index) => {
          const response = await fetch(grant.url, {
            method: "PUT",
            headers: grant.headers,
            body: files[index],
          });
          if (!response.ok) throw new Error(`upload failed: ${response.status}`);
          submitted.append("tickets", grant.ticket);
        }),
      );
    } catch {
      setStatus("idle");
      setError(MESSAGES.transfer);
      return;
    }

    // Redirects on success; the task is completed server-side.
    await uploadDocuments(submitted);
  };

  const isUploading = status === "uploading";

  return (
    <form
      onSubmit={handleSubmit}
      style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}
    >
      <div className="field">
        <label htmlFor="files">Dateien auswählen</label>
        <input
          id="files"
          name="files"
          type="file"
          multiple
          required
          ref={inputRef}
          disabled={isUploading}
          accept="application/pdf,image/jpeg,image/png"
        />
      </div>
      {error ? (
        <p role="alert" className="form-error">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        className="button"
        disabled={isUploading}
        aria-busy={isUploading}
      >
        {isUploading ? "Wird übertragen …" : "Hochladen"}
      </button>
    </form>
  );
}
