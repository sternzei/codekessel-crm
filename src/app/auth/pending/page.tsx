import Image from "next/image";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { LegalLinks } from "@/components/legal/legal-links";

// Where a Google sign-in lands when the account may not be used (yet). It is
// deliberately stateless: it reads no account and says nothing about which
// address was presented, so it cannot be used to probe who has access here.

const STATES = ["rejected", "deactivated"] as const;

type PendingState = (typeof STATES)[number];

const isPendingState = (value: string | undefined): value is PendingState =>
  !!value && (STATES as readonly string[]).includes(value);

export default async function AccessPendingPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  const { state } = await searchParams;
  const t = await getTranslations("auth.pending");
  const variant = isPendingState(state) ? state : "pending";

  const copy = {
    pending: { title: t("title"), body: t("body") },
    rejected: { title: t("rejectedTitle"), body: t("rejectedBody") },
    deactivated: { title: t("deactivatedTitle"), body: t("deactivatedBody") },
  }[variant];

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
          <h1>{copy.title}</h1>
        </header>
        <p className="auth-note">{copy.body}</p>
        <Link href="/auth/sign-in" className="button button--ghost">
          {t("back")}
        </Link>
      </main>
      <LegalLinks />
    </div>
  );
}
