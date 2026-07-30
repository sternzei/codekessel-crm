import Image from "next/image";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { LegalLinks } from "@/components/legal/legal-links";
import { login } from "@/modules/auth/actions";
import { getSession } from "@/modules/auth/session";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await getSession();
  if (session) redirect("/pipeline");

  const { error } = await searchParams;
  const t = await getTranslations("auth");

  return (
    <div className="auth-viewport">
      <main className="auth-card">
        <header>
          <Image
            src="/brand/codekessel-wordmark.png"
            alt="CodeKessel"
            width={1024}
            height={298}
            className="auth-wordmark"
            priority
            unoptimized
          />
          <h1>{t("title")}</h1>
          <p style={{ marginTop: "var(--space-2)", color: "var(--color-ink-faint)", fontSize: "var(--text-sm)" }}>
            {t("subtitle")}
          </p>
        </header>

        {error === "rate" ? (
          <p className="form-error">
            Zu viele Anmeldeversuche. Bitte warten Sie einen Moment und
            versuchen Sie es erneut.
          </p>
        ) : error ? (
          <p className="form-error">{t("error")}</p>
        ) : null}

        <form action={login} style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          <div className="field">
            <label htmlFor="email">{t("email")}</label>
            <input id="email" name="email" type="email" autoComplete="email" required />
          </div>
          <div className="field">
            <label htmlFor="password">{t("password")}</label>
            <input id="password" name="password" type="password" autoComplete="current-password" required />
          </div>
          <button type="submit" className="button">
            {t("submit")}
          </button>
        </form>
      </main>
      <LegalLinks />
    </div>
  );
}
