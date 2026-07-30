import Link from "next/link";
import { getTranslations } from "next-intl/server";

export default async function InternalNotFound() {
  const t = await getTranslations("errors");

  return (
    <div className="card" role="status" aria-live="polite">
      <header className="page-header" style={{ marginBottom: "var(--space-4)" }}>
        <h1>{t("notFoundTitle")}</h1>
        <p>{t("notFoundBody")}</p>
      </header>
      <Link href="/pipeline" className="button" aria-label={t("home")}>
        {t("home")}
      </Link>
    </div>
  );
}
