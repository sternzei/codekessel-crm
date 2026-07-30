"use client";

/**
 * Last-resort App Router error boundary (replaces the root layout).
 * Keep markup self-contained — no shared layout chrome or i18n provider.
 */
export default function GlobalError({
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  const handleRetry = (): void => {
    reset();
  };

  const handleRetryKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
  ): void => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      reset();
    }
  };

  return (
    <html lang="de">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          fontFamily: "Georgia, 'Times New Roman', serif",
          background:
            "linear-gradient(160deg, #1a1f1c 0%, #2c3330 45%, #1e2421 100%)",
          color: "#f4f1ea",
        }}
      >
        <main
          style={{
            maxWidth: "28rem",
            padding: "2rem",
            textAlign: "center",
          }}
          role="alert"
          aria-live="assertive"
        >
          <p
            style={{
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              fontSize: "0.75rem",
              opacity: 0.7,
              marginBottom: "0.75rem",
            }}
          >
            CodeKessel
          </p>
          <h1 style={{ fontSize: "1.5rem", margin: "0 0 0.75rem" }}>
            Etwas ist schiefgelaufen
          </h1>
          <p style={{ opacity: 0.85, marginBottom: "1.5rem", lineHeight: 1.5 }}>
            Die Anwendung konnte diese Anfrage nicht verarbeiten. Bitte
            versuchen Sie es erneut.
          </p>
          <button
            type="button"
            onClick={handleRetry}
            onKeyDown={handleRetryKeyDown}
            tabIndex={0}
            aria-label="Erneut versuchen"
            style={{
              appearance: "none",
              border: "1px solid rgba(244,241,234,0.35)",
              background: "transparent",
              color: "#f4f1ea",
              padding: "0.65rem 1.25rem",
              cursor: "pointer",
              font: "inherit",
            }}
          >
            Erneut versuchen
          </button>
        </main>
      </body>
    </html>
  );
}
