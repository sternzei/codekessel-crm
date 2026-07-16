import { asc } from "drizzle-orm";
import { redirect } from "next/navigation";
import { withTenant } from "@/db/client";
import { employers } from "@/db/schema";
import { getSession } from "@/modules/auth/session";
import { createEmployerSetupLink } from "@/modules/tasks/actions";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  new: { label: "Neu", cls: "badge" },
  invited: { label: "Eingeladen", cls: "badge" },
  setup_in_progress: { label: "Setup läuft", cls: "badge badge--warn" },
  betriebsnummer_missing: { label: "Betriebsnummer fehlt", cls: "badge badge--danger" },
  ags_unclear: { label: "AG-S unklar", cls: "badge badge--danger" },
  time_model_pending: { label: "Zeitmodell offen", cls: "badge badge--warn" },
  confirmed: { label: "Bestätigt", cls: "badge badge--ok" },
  declined: { label: "Abgelehnt", cls: "badge badge--danger" },
};

export default async function EmployersPage({
  searchParams,
}: {
  searchParams: Promise<{ link?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/auth/sign-in");
  const { link } = await searchParams;

  const rows = await withTenant(session.tenantId, (tx) =>
    tx.select().from(employers).orderBy(asc(employers.companyName)),
  );

  return (
    <>
      <header className="page-header">
        <h1>Arbeitgeber</h1>
        <p>
          Der Setup-Assistent führt Arbeitgeber durch Betriebsnummer → AG-S →
          Ansprechperson → Zeitmodell. Der Status leitet sich automatisch aus
          dem nächsten Engpass ab.
        </p>
      </header>

      {link ? (
        <div className="card" style={{ marginBottom: "var(--space-6)" }}>
          <p style={{ fontSize: "var(--text-sm)", fontWeight: 600, marginBottom: "var(--space-2)" }}>
            Setup-Link erstellt — per WhatsApp/E-Mail versenden:
          </p>
          <code data-testid="setup-link" style={{ fontSize: "var(--text-xs)", wordBreak: "break-all", display: "block" }}>
            {link}
          </code>
        </div>
      ) : null}

      <div className="data-list">
        {rows.map((e) => {
          const badge = STATUS_LABEL[e.status] ?? { label: e.status, cls: "badge" };
          return (
            <article key={e.id} className="data-row" style={{ gridTemplateColumns: "1fr auto auto" }}>
              <div>
                <div className="title">{e.companyName}</div>
                <div className="meta">
                  {e.city ?? "—"} · {e.industry ?? "—"} ·{" "}
                  {e.betriebsnummer
                    ? `BN ${e.betriebsnummer}`
                    : "keine Betriebsnummer"}
                  {e.contactName ? ` · ${e.contactName}` : ""}
                </div>
              </div>
              <span className={badge.cls}>{badge.label}</span>
              {e.status !== "confirmed" ? (
                <form action={createEmployerSetupLink}>
                  <input type="hidden" name="employerId" value={e.id} />
                  <button type="submit" className="button button--sm button--ghost">
                    Setup-Link erzeugen
                  </button>
                </form>
              ) : (
                <span />
              )}
            </article>
          );
        })}
      </div>
    </>
  );
}
