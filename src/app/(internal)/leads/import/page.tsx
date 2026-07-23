import Link from "next/link";
import { redirect } from "next/navigation";
import { withTenant } from "@/db/client";
import { getAdminSession, getSession } from "@/modules/auth/session";
import { getRegisterProvider } from "@/modules/register";
import { importCompanies, importCompany } from "@/modules/register/actions";
import {
  DEFAULT_FEDERAL_STATE,
  FEDERAL_STATE_LABELS,
  LEGAL_FORM_OPTIONS,
} from "@/modules/register/filters";
import { listImportedRegisterIds } from "@/modules/register/queries";

export const dynamic = "force-dynamic";

const PER_PAGE = 25;
const DEFAULT_EMP_MIN = 10;
const DEFAULT_EMP_MAX = 50;

function clampInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/** Query params may arrive as a single string or an array — normalize to a list. */
function toArray(value: string | string[] | undefined): string[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

/** Rebuilds the discovery query string, preserving every active filter. */
function buildDiscoveryQuery(params: {
  employeesMin: number;
  employeesMax: number;
  federalState: string;
  legalForms: string[];
  page: number;
}): string {
  const qs = new URLSearchParams();
  qs.set("run", "1");
  qs.set("empMin", String(params.employeesMin));
  qs.set("empMax", String(params.employeesMax));
  qs.set("federalState", params.federalState);
  qs.set("page", String(params.page));
  for (const form of params.legalForms) qs.append("legalForms", form);
  return `/leads/import?${qs.toString()}`;
}

export default async function RegisterImportPage({
  searchParams,
}: {
  searchParams: Promise<{
    empMin?: string;
    empMax?: string;
    page?: string;
    error?: string;
    run?: string;
    federalState?: string;
    legalForms?: string | string[];
  }>;
}) {
  // Admin-only: enforced here AND in the import action.
  const admin = await getAdminSession();
  if (!admin) {
    const session = await getSession();
    redirect(session ? "/pipeline?forbidden=1" : "/auth/sign-in");
  }

  const sp = await searchParams;
  const provider = getRegisterProvider();
  const employeesMin = clampInt(sp.empMin, DEFAULT_EMP_MIN);
  const employeesMax = clampInt(sp.empMax, DEFAULT_EMP_MAX);
  const page = clampInt(sp.page, 1);
  const hasRun = sp.run === "1";
  // Default the region to the configured target (Baden-Württemberg) until the
  // admin explicitly chooses another (or "Alle Bundesländer" → empty string).
  const federalState = sp.federalState ?? DEFAULT_FEDERAL_STATE;
  const legalForms = toArray(sp.legalForms);

  return (
    <>
      <header className="page-header">
        <p style={{ marginBottom: "var(--space-1)" }}>
          <Link href="/pipeline">← Pipeline</Link>
        </p>
        <h1>
          Register-Import{" "}
          <span className="badge" style={{ verticalAlign: "middle" }}>
            {provider.mode === "live" ? "OpenRegister live" : "Demo (Mock)"}
          </span>
        </h1>
        <p>
          Zahlungsschwache Unternehmen (aktiv, im Verlust) aus dem
          Handelsregister finden und als Lead übernehmen — Zielprofil für
          AZAV-Förderung. Nur für Verwaltung.
        </p>
      </header>

      {sp.error === "notfound" ? (
        <p className="gate-banner" style={{ marginBottom: "var(--space-6)" }}>
          Unternehmen nicht gefunden. Bitte erneut suchen.
        </p>
      ) : null}

      <section className="section" aria-label="Suchkriterien">
        <h2>Unternehmen entdecken</h2>
        <form method="get" className="inline-form">
          <input type="hidden" name="run" value="1" />
          <div className="field">
            <label htmlFor="empMin">Mitarbeitende ab</label>
            <input id="empMin" name="empMin" type="number" min="1" defaultValue={employeesMin} />
          </div>
          <div className="field">
            <label htmlFor="empMax">bis</label>
            <input id="empMax" name="empMax" type="number" min="1" defaultValue={employeesMax} />
          </div>
          <div className="field">
            <label htmlFor="federalState">Bundesland</label>
            <select id="federalState" name="federalState" defaultValue={federalState}>
              <option value="">Alle Bundesländer</option>
              {Object.entries(FEDERAL_STATE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend style={{ fontSize: "var(--text-sm)" }}>Rechtsform</legend>
            <div className="quick-actions" style={{ gap: "var(--space-2)" }}>
              {LEGAL_FORM_OPTIONS.map((form) => (
                <label
                  key={form.value}
                  style={{ display: "inline-flex", gap: "var(--space-1)", alignItems: "center" }}
                >
                  <input
                    type="checkbox"
                    name="legalForms"
                    value={form.value}
                    defaultChecked={legalForms.includes(form.value)}
                  />
                  {form.label}
                </label>
              ))}
            </div>
          </fieldset>
          <button type="submit" className="button button--sm">
            Verlust-Unternehmen suchen
          </button>
        </form>
        <p style={{ fontSize: "var(--text-xs)", color: "var(--color-ink-faint)" }}>
          Serverseitiger Filter: aktiv · Jahresergebnis &lt; 0 · Mitarbeitende im
          Bereich. Bundesland (PLZ-Präfix) und Rechtsform werden clientseitig auf
          die Ergebnisseite angewendet. Eine Ergebnisseite kostet 10 Credits, ein
          Import weitere 10.
        </p>
      </section>

      {hasRun ? (
        <Results
          tenantId={admin.tenantId}
          employeesMin={employeesMin}
          employeesMax={employeesMax}
          federalState={federalState}
          legalForms={legalForms}
          page={page}
        />
      ) : null}
    </>
  );
}

async function Results({
  tenantId,
  employeesMin,
  employeesMax,
  federalState,
  legalForms,
  page,
}: {
  tenantId: string;
  employeesMin: number;
  employeesMax: number;
  federalState: string;
  legalForms: string[];
  page: number;
}) {
  const provider = getRegisterProvider();
  const result = await provider.searchDistressed({
    employeesMin,
    employeesMax,
    federalState,
    legalForms,
    page,
    perPage: PER_PAGE,
  });
  const importedIds = await withTenant(tenantId, (tx) =>
    listImportedRegisterIds(
      tx,
      tenantId,
      result.companies.map((c) => c.companyId),
    ),
  );

  const qs = (p: number) =>
    buildDiscoveryQuery({ employeesMin, employeesMax, federalState, legalForms, page: p });
  const importableCompanies = result.companies.filter(
    (c) => !importedIds.has(c.companyId),
  );

  return (
    <section className="section" aria-label="Ergebnisse">
      <h2>
        Verlust-Unternehmen ({result.totalResults}) · Seite {result.page}/
        {Math.max(result.totalPages, 1)}
      </h2>
      {importableCompanies.length > 0 ? (
        <form action={importCompanies} style={{ marginBottom: "var(--space-4)" }}>
          <input type="hidden" name="employeesMin" value={employeesMin} />
          <input type="hidden" name="employeesMax" value={employeesMax} />
          <input type="hidden" name="federalState" value={federalState} />
          <input type="hidden" name="page" value={page} />
          {legalForms.map((form) => (
            <input key={form} type="hidden" name="legalForms" value={form} />
          ))}
          {importableCompanies.map((c) => (
            <div key={c.companyId}>
              <input type="hidden" name="companyId" value={c.companyId} />
              <input type="hidden" name="profitEur" value={c.profitEur ?? ""} />
              <input type="hidden" name="fiscalYear" value={c.fiscalYear ?? ""} />
              <input type="hidden" name="employees" value={c.employees ?? ""} />
              <input
                type="hidden"
                name="financialsSource"
                value={c.financialsSource ?? ""}
              />
            </div>
          ))}
          <button type="submit" className="button button--sm">
            Alle {importableCompanies.length} auf dieser Seite importieren
          </button>
        </form>
      ) : null}
      {result.companies.length === 0 ? (
        <p className="data-row meta" style={{ display: "block" }}>
          Keine Treffer für diese Kriterien.
        </p>
      ) : (
        result.companies.map((c) => {
          const imported = importedIds.has(c.companyId);
          const fin = [
            c.profitEur != null
              ? `${Math.round(c.profitEur).toLocaleString("de-DE")} €`
              : null,
            c.fiscalYear ? `GJ ${c.fiscalYear}` : null,
            c.employees != null ? `${c.employees} MA` : null,
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <div key={c.companyId} className="note">
              <p>
                <strong>{c.name}</strong>{" "}
                {imported ? (
                  <span className="badge">bereits importiert</span>
                ) : null}
              </p>
              <p className="meta">
                {[c.registerType, c.registerNumber].filter(Boolean).join(" ")}
                {c.city ? ` · ${c.city}` : ""}
                {c.legalForm ? ` · ${c.legalForm}` : ""}
                {fin ? ` · ${fin}` : ""}
              </p>
              <form action={importCompany} style={{ marginTop: "var(--space-2)" }}>
                <input type="hidden" name="companyId" value={c.companyId} />
                <input type="hidden" name="profitEur" value={c.profitEur ?? ""} />
                <input type="hidden" name="fiscalYear" value={c.fiscalYear ?? ""} />
                <input type="hidden" name="employees" value={c.employees ?? ""} />
                <input
                  type="hidden"
                  name="financialsSource"
                  value={c.financialsSource ?? ""}
                />
                <button
                  type="submit"
                  className="button button--sm button--ghost"
                  disabled={imported}
                >
                  {imported ? "Importiert" : "Als Lead importieren"}
                </button>
              </form>
            </div>
          );
        })
      )}

      <div className="inline-form" style={{ marginTop: "var(--space-4)" }}>
        {result.page > 1 ? (
          <Link href={qs(result.page - 1)} className="button button--sm button--ghost">
            ← Zurück
          </Link>
        ) : null}
        {result.page < result.totalPages ? (
          <Link href={qs(result.page + 1)} className="button button--sm button--ghost">
            Weiter →
          </Link>
        ) : null}
      </div>
    </section>
  );
}
