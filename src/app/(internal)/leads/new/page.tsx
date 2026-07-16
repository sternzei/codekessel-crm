import Link from "next/link";
import { redirect } from "next/navigation";
import { createLead } from "@/modules/participants/actions-internal";
import { getSession } from "@/modules/auth/session";

export default async function NewLeadPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/auth/sign-in");
  const { error } = await searchParams;

  return (
    <>
      <header className="page-header">
        <p style={{ marginBottom: "var(--space-1)" }}>
          <Link href="/pipeline">← Pipeline</Link>
        </p>
        <h1>Neuer Lead</h1>
        <p>Wird dir als Berater:in zugewiesen und startet im Status „Neuer Lead“.</p>
      </header>

      {error ? (
        <p className="form-error" style={{ marginBottom: "var(--space-4)" }}>
          Bitte Vor- und Nachname angeben (E-Mail-Format prüfen).
        </p>
      ) : null}

      <form
        action={createLead}
        className="section"
        style={{ maxWidth: "28rem", gap: "var(--space-4)" }}
      >
        <div className="field">
          <label htmlFor="firstName">Vorname *</label>
          <input id="firstName" name="firstName" required />
        </div>
        <div className="field">
          <label htmlFor="lastName">Nachname *</label>
          <input id="lastName" name="lastName" required />
        </div>
        <div className="field">
          <label htmlFor="phone">Telefon</label>
          <input id="phone" name="phone" type="tel" />
        </div>
        <div className="field">
          <label htmlFor="email">E-Mail</label>
          <input id="email" name="email" type="email" />
        </div>
        <div className="field">
          <label htmlFor="city">Ort</label>
          <input id="city" name="city" />
        </div>
        <div className="field">
          <label htmlFor="source">Quelle</label>
          <input id="source" name="source" placeholder="z. B. Meta Ads, Website, Empfehlung" />
        </div>
        <button type="submit" className="button">
          Lead anlegen
        </button>
      </form>
    </>
  );
}
