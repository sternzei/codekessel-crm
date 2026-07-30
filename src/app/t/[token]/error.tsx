"use client";

import { useTranslations } from "next-intl";

export default function TokenError({
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
    <div className="task-viewport">
      <main className="task-card" role="alert" aria-live="assertive">
        <h1>{t("tokenTitle")}</h1>
        <p>{t("tokenBody")}</p>
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
      </main>
    </div>
  );
}
