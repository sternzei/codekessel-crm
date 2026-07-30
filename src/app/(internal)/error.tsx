"use client";

import { useTranslations } from "next-intl";

export default function InternalError({
  error,
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  const t = useTranslations("errors");

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
    <div className="card" role="alert" aria-live="assertive">
      <header className="page-header" style={{ marginBottom: "var(--space-4)" }}>
        <h1>{t("title")}</h1>
        <p>{t("body")}</p>
      </header>
      <button
        type="button"
        className="button"
        onClick={handleRetry}
        onKeyDown={handleRetryKeyDown}
        tabIndex={0}
        aria-label={t("retry")}
      >
        {t("retry")}
      </button>
      {/* The digest is the only handle that ties this screen to a server log
          line, so support can find the incident from a screenshot. */}
      {error.digest ? (
        <p className="meta" style={{ marginTop: "var(--space-4)" }}>
          {t("reference", { digest: error.digest })}
        </p>
      ) : null}
    </div>
  );
}
