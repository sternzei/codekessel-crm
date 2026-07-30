import { getTranslations } from "next-intl/server";

export default async function TokenNotFound() {
  const t = await getTranslations("errors");

  return (
    <div className="task-viewport">
      <main className="task-card" role="status" aria-live="polite">
        <h1>{t("tokenNotFoundTitle")}</h1>
        <p>{t("tokenNotFoundBody")}</p>
      </main>
    </div>
  );
}
