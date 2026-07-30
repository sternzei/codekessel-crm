import { getTranslations } from "next-intl/server";

export default async function TokenLoading() {
  const t = await getTranslations("errors");

  return (
    <div className="task-viewport">
      <main className="task-card" role="status" aria-live="polite" aria-busy="true">
        <p>{t("tokenLoading")}</p>
      </main>
    </div>
  );
}
