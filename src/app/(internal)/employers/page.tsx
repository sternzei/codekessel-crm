import { asc } from "drizzle-orm";
import { redirect } from "next/navigation";
import { withTenant } from "@/db/client";
import { employers } from "@/db/schema";
import { getSession } from "@/modules/auth/session";
import { createEmployerSetupLink } from "@/modules/tasks/actions";
import { updateEmployerBaData } from "@/modules/employers/actions-internal";
import { STAFFING_BANDS } from "@/lib/ba-format";

export const dynamic = "force-dynamic";

type EmployerRow = typeof employers.$inferSelect;

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
  searchParams: Promise<{ link?: string; badata?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/auth/sign-in");
  const { link, badata } = await searchParams;

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

      {badata === "saved" ? (
        <p className="info-banner" style={{ marginBottom: "var(--space-6)" }}>
          BA-Antragsdaten gespeichert.
        </p>
      ) : null}
      {badata === "iban" || badata === "bic" ? (
        <p className="gate-banner" style={{ marginBottom: "var(--space-6)" }}>
          {badata === "iban"
            ? "Die IBAN ist ungültig (Prüfsumme)."
            : "Der BIC hat kein gültiges Format."}{" "}
          Die übrigen Angaben wurden nicht gespeichert.
        </p>
      ) : null}

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
            <div key={e.id} className="section-stack">
              <article className="data-row" style={{ gridTemplateColumns: "1fr auto auto" }}>
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
              <details className="instructions">
                <summary>BA-Antragsdaten bearbeiten</summary>
                <EmployerBaForm employer={e} />
              </details>
            </div>
          );
        })}
      </div>
    </>
  );
}

function EmployerBaForm({ employer: e }: { employer: EmployerRow }) {
  const staffing = new Map(
    (e.staffingByHoursBand ?? []).map((b) => [b.band, b.count]),
  );
  const components = e.salaryComponents ?? [];
  return (
    <form
      action={updateEmployerBaData}
      style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}
    >
      <input type="hidden" name="employerId" value={e.id} />
      <div className="inline-form">
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor={`legalForm-${e.id}`}>Rechtsform</label>
          <input
            id={`legalForm-${e.id}`}
            name="legalForm"
            defaultValue={e.legalForm ?? ""}
            placeholder="z. B. GmbH"
          />
        </div>
        <div className="field" style={{ width: "12rem" }}>
          <label htmlFor={`betriebsvereinbarung-${e.id}`}>
            Betriebsvereinbarung/Tarifvertrag
          </label>
          <select
            id={`betriebsvereinbarung-${e.id}`}
            name="betriebsvereinbarung"
            defaultValue={
              e.hasBetriebsvereinbarung == null
                ? ""
                : e.hasBetriebsvereinbarung
                  ? "yes"
                  : "no"
            }
          >
            <option value="">— unbekannt —</option>
            <option value="yes">Ja</option>
            <option value="no">Nein</option>
          </select>
        </div>
      </div>
      <div className="inline-form">
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor={`iban-${e.id}`}>IBAN (Geschäftskonto)</label>
          <input id={`iban-${e.id}`} name="iban" defaultValue={e.iban ?? ""} />
        </div>
        <div className="field" style={{ width: "9rem" }}>
          <label htmlFor={`bic-${e.id}`}>BIC</label>
          <input id={`bic-${e.id}`} name="bic" defaultValue={e.bic ?? ""} />
        </div>
      </div>
      <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
        <legend style={{ fontSize: "var(--text-sm)", fontWeight: 600 }}>
          Beschäftigtenzahlen nach Stunden-Faktoren
        </legend>
        <div className="inline-form">
          {STAFFING_BANDS.map((band) => (
            <div className="field" key={band.key} style={{ width: "12rem" }}>
              <label htmlFor={`staffing_${band.key}-${e.id}`}>{band.label}</label>
              <input
                id={`staffing_${band.key}-${e.id}`}
                name={`staffing_${band.key}`}
                inputMode="numeric"
                defaultValue={staffing.get(band.key)?.toString() ?? ""}
              />
            </div>
          ))}
        </div>
      </fieldset>
      <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
        <legend style={{ fontSize: "var(--text-sm)", fontWeight: 600 }}>
          Vergütungsbestandteile
        </legend>
        {[0, 1, 2].map((i) => (
          <div className="inline-form" key={i}>
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor={`salaryLabel${i}-${e.id}`}>Bezeichnung</label>
              <input
                id={`salaryLabel${i}-${e.id}`}
                name={`salaryLabel${i}`}
                defaultValue={components[i]?.label ?? ""}
              />
            </div>
            <div className="field" style={{ width: "8rem" }}>
              <label htmlFor={`salaryAmount${i}-${e.id}`}>Betrag (EUR)</label>
              <input
                id={`salaryAmount${i}-${e.id}`}
                name={`salaryAmount${i}`}
                inputMode="decimal"
                defaultValue={components[i] ? String(components[i].amountEur) : ""}
              />
            </div>
          </div>
        ))}
      </fieldset>
      <button type="submit" className="button button--sm">
        BA-Antragsdaten speichern
      </button>
    </form>
  );
}
