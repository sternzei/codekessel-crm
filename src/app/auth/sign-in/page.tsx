import Image from "next/image";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { LegalLinks } from "@/components/legal/legal-links";
import { login } from "@/modules/auth/actions";
import { isGoogleSignInConfigured } from "@/modules/auth/google/config";
import { getSession } from "@/modules/auth/session";

/** Google's brand mark — required by their branding guidelines on the button. */
const GoogleMark = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
    <path
      fill="#4285F4"
      d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
    />
    <path
      fill="#34A853"
      d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
    />
    <path
      fill="#FBBC05"
      d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z"
    />
    <path
      fill="#EA4335"
      d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
    />
  </svg>
);

const GOOGLE_ERROR_KEYS: Record<string, string> = {
  google: "google.failed",
  google_unverified: "google.unverified",
  google_conflict: "google.conflict",
  google_closed: "google.closed",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await getSession();
  if (session) redirect("/pipeline");

  const { error } = await searchParams;
  const t = await getTranslations("auth");
  const googleErrorKey = error ? GOOGLE_ERROR_KEYS[error] : undefined;
  const showGoogle = isGoogleSignInConfigured();

  return (
    <div className="auth-viewport">
      <div className="auth-shell">
        {/* The wordmark's second half is white, so it only reads on a dark
            surface — which is also where the brand panel belongs. */}
        <aside className="auth-brand">
          <span className="auth-brand-atmosphere" aria-hidden="true">
            <Image
              src="/brand/codekessel-mark.png"
              alt=""
              width={856}
              height={908}
              className="auth-brand-watermark"
              priority
            />
          </span>
          <div className="auth-brand-content">
            <Image
              src="/brand/codekessel-wordmark-on-dark.png"
              alt="CodeKessel"
              width={1024}
              height={298}
              className="auth-brand-wordmark"
              priority
              unoptimized
            />
            <p className="auth-brand-lead">{t("brand.lead")}</p>
            <ul className="auth-brand-points">
              <li>{t("brand.point1")}</li>
              <li>{t("brand.point2")}</li>
              <li>{t("brand.point3")}</li>
            </ul>
          </div>
        </aside>

        <main className="auth-panel">
          <header className="auth-panel-header">
            <h1>{t("title")}</h1>
            <p className="auth-subtitle">{t("subtitle")}</p>
          </header>

          {error === "rate" ? (
            <p className="form-error">{t("rateLimited")}</p>
          ) : googleErrorKey ? (
            <p className="form-error">{t(googleErrorKey)}</p>
          ) : error ? (
            <p className="form-error">{t("error")}</p>
          ) : null}

          <form action={login} className="auth-form">
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

          {showGoogle ? (
            <>
              <p className="auth-divider">{t("google.divider")}</p>
              <a
                href="/auth/google/start"
                className="button button--ghost auth-google"
                aria-label={t("google.submit")}
              >
                <GoogleMark />
                {t("google.submit")}
              </a>
            </>
          ) : null}
        </main>
      </div>
      <LegalLinks />
    </div>
  );
}
