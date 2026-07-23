import { z } from "zod";
import { applyDiscoveryFilters } from "./filters";
import {
  RegisterCreditError,
  RegisterRequestError,
  type DistressedCriteria,
  type DistressedSearchResult,
  type FinancialsSource,
  type RegisterCompanyDetail,
  type RegisterCompanySummary,
  type RegisterDistressedCompany,
  type RegisterProvider,
  type RegisterRepresentative,
} from "./types";

const REQUEST_TIMEOUT_MS = 15_000;

// Register roles that mark a current natural person as a managing director /
// Geschäftsführer / Vorstand — matched case-insensitively against substrings.
const MANAGING_ROLE_HINTS = [
  "director",
  "geschaeft",
  "geschäft",
  "vorstand",
  "inhaber",
  "managing",
  "owner",
];

// ---------------------------------------------------------------------------
// Raw wire schemas — intentionally lenient: the API returns far more than we
// use, so we validate only the fields we read and pass everything else through.
// ---------------------------------------------------------------------------

const autocompleteSchema = z.object({
  results: z
    .array(
      z
        .object({
          company_id: z.string(),
          name: z.string().optional(),
          register_number: z.string().nullish(),
          register_type: z.string().nullish(),
          address: z.object({ city: z.string().nullish() }).nullish(),
        })
        .passthrough(),
    )
    .default([]),
});

const representationSchema = z
  .object({
    name: z.string().nullish(),
    role: z.string().nullish(),
    end_date: z.string().nullish(),
    natural_person: z
      .object({
        first_name: z.string().nullish(),
        last_name: z.string().nullish(),
        city: z.string().nullish(),
      })
      .nullish(),
  })
  .passthrough();

const companySchema = z
  .object({
    id: z.string().nullish(),
    name: z
      .object({ name: z.string().nullish(), legal_form: z.string().nullish() })
      .nullish(),
    legal_form: z.string().nullish(),
    register: z
      .object({
        company_id: z.string().nullish(),
        register_number: z.string().nullish(),
        register_type: z.string().nullish(),
        register_court: z.string().nullish(),
      })
      .nullish(),
    address: z
      .object({
        street: z.string().nullish(),
        postal_code: z.string().nullish(),
        city: z.string().nullish(),
      })
      .nullish(),
    industry_codes: z.record(z.string(), z.unknown()).nullish(),
    status: z.string().nullish(),
    incorporated_at: z.string().nullish(),
    contact: z
      .object({
        email: z.string().nullish(),
        phone: z.string().nullish(),
        website_url: z.string().nullish(),
      })
      .nullish(),
    representation: z.array(representationSchema).default([]),
  })
  .passthrough();

export type RawCompany = z.infer<typeof companySchema>;

const indicatorSchema = z
  .object({
    date: z.string().nullish(),
    net_income: z.number().nullish(),
    revenue: z.number().nullish(),
    employees: z.number().nullish(),
  })
  .passthrough();

const searchResponseSchema = z.object({
  results: z
    .array(
      z
        .object({
          company_id: z.string(),
          name: z.string().nullish(),
          register_number: z.string().nullish(),
          register_type: z.string().nullish(),
          legal_form: z.string().nullish(),
          address: z
            .object({
              city: z.string().nullish(),
              // Optional — used for client-side federal-state filtering. Read
              // leniently; absent on rows that omit an address.
              postal_code: z.string().nullish(),
            })
            .nullish(),
          indicators: z.array(indicatorSchema).nullish(),
          net_income: z.number().nullish(),
          revenue: z.number().nullish(),
          fiscal_year: z.union([z.string(), z.number()]).nullish(),
          employees: z.number().nullish(),
          // Best-effort industry codes, same shape as the company detail's
          // confirmed `industry_codes`. Read leniently (nullish) for
          // client-side Branche filtering; absent on rows that omit it.
          industry_codes: z.record(z.string(), z.unknown()).nullish(),
        })
        .passthrough(),
    )
    .default([]),
  pagination: z
    .object({
      page: z.number().nullish(),
      total_pages: z.number().nullish(),
      total_results: z.number().nullish(),
    })
    .nullish(),
});

type RawSearchRow = z.infer<typeof searchResponseSchema>["results"][number];

export type SearchFinancials = {
  profitEur: number | null;
  revenueEur: number | null;
  fiscalYear: string | null;
  employees: number | null;
  financialsSource: FinancialsSource | null;
};

// OpenRegister reports `indicators[]` monetary values in CENTS (verified
// against the reference lead-gen pipeline). Sign is meaningful: a loss is a
// negative net income and must stay negative. A genuine 0 (break-even) is a
// real value; only null/undefined counts as "missing".
function centsToEuro(cents: number | null | undefined): number | null {
  if (cents == null) return null;
  return Math.round(cents) / 100;
}

/**
 * Best-effort financials for one search row. Prefers the latest `indicators[]`
 * entry (cents → euro); falls back to the flat row fields (already euro).
 * Missing data stays missing — it is NEVER coerced to 0 — and the reporting
 * year plus the figures' source/unit origin are returned alongside the values.
 */
export function extractSearchFinancials(row: RawSearchRow): SearchFinancials {
  const latest = (row.indicators ?? [])
    .slice()
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))[0];

  const indicatorYear = latest?.date ? latest.date.slice(0, 4) : null;
  const indicatorProfit = centsToEuro(latest?.net_income);
  const indicatorRevenue = centsToEuro(latest?.revenue);

  if (indicatorProfit != null || indicatorRevenue != null) {
    return {
      profitEur: indicatorProfit,
      revenueEur: indicatorRevenue,
      fiscalYear: indicatorYear,
      employees: latest?.employees ?? row.employees ?? null,
      financialsSource: "indicators",
    };
  }

  const rowProfit = row.net_income ?? null;
  const rowRevenue = row.revenue ?? null;
  const rowYear =
    row.fiscal_year != null ? String(row.fiscal_year).slice(0, 4) : null;
  const employees = latest?.employees ?? row.employees ?? null;

  if (rowProfit != null || rowRevenue != null) {
    return {
      profitEur: rowProfit,
      revenueEur: rowRevenue,
      fiscalYear: rowYear ?? indicatorYear,
      employees,
      financialsSource: "search_row",
    };
  }

  // No monetary figures anywhere: keep them missing, but pass through any
  // non-monetary context (reporting year, employees) we did find.
  return {
    profitEur: null,
    revenueEur: null,
    fiscalYear: indicatorYear ?? rowYear,
    employees,
    financialsSource: null,
  };
}

// ---------------------------------------------------------------------------
// Pure mappers (exported for unit tests — no network).
// ---------------------------------------------------------------------------

function isManagingRole(role: string): boolean {
  const r = role.toLowerCase();
  return MANAGING_ROLE_HINTS.some((hint) => r.includes(hint));
}

/** Current natural-person mandates only, managing directors first. */
export function normalizeRepresentatives(
  raw: RawCompany["representation"],
): RegisterRepresentative[] {
  const current = raw
    .filter((r) => !r.end_date) // drop former officers
    .filter((r) => r.natural_person) // people only — legal-person officers can't be a lead
    .map((r): RegisterRepresentative => {
      const role = r.role ?? "";
      const np = r.natural_person!;
      return {
        name: r.name ?? [np.first_name, np.last_name].filter(Boolean).join(" "),
        firstName: np.first_name ?? null,
        lastName: np.last_name ?? null,
        role,
        city: np.city ?? null,
        isManagingDirector: isManagingRole(role),
      };
    });

  // Managing directors first, otherwise preserve register order.
  return current.sort(
    (a, b) => Number(b.isManagingDirector) - Number(a.isManagingDirector),
  );
}

function firstIndustryCode(
  codes: RawCompany["industry_codes"],
): string | null {
  if (!codes) return null;
  for (const value of Object.values(codes)) {
    if (Array.isArray(value) && value.length > 0) {
      const first = value[0];
      if (first && typeof first === "object" && "code" in first) {
        const code = (first as { code?: unknown }).code;
        if (typeof code === "string") return code;
      }
    }
  }
  return null;
}

export function normalizeCompany(raw: RawCompany): RegisterCompanyDetail {
  const register = raw.register ?? {};
  return {
    companyId: register.company_id ?? raw.id ?? "",
    name: raw.name?.name ?? "",
    legalForm: raw.legal_form ?? raw.name?.legal_form ?? null,
    registerNumber: register.register_number ?? null,
    registerType: register.register_type ?? null,
    registerCourt: register.register_court ?? null,
    status: raw.status ?? null,
    incorporatedAt: raw.incorporated_at ?? null,
    address: {
      street: raw.address?.street ?? null,
      postalCode: raw.address?.postal_code ?? null,
      city: raw.address?.city ?? null,
    },
    industryCode: firstIndustryCode(raw.industry_codes),
    contact: {
      email: raw.contact?.email ?? null,
      phone: raw.contact?.phone ?? null,
      website: raw.contact?.website_url ?? null,
    },
    representatives: normalizeRepresentatives(raw.representation),
  };
}

// ---------------------------------------------------------------------------
// Live adapter
// ---------------------------------------------------------------------------

export class OpenRegisterProvider implements RegisterProvider {
  readonly mode = "live" as const;

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
  ) {}

  private async get(path: string): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: "application/json",
        },
        signal: controller.signal,
      });
      if (res.status === 429) throw new RegisterCreditError();
      if (res.status === 404) return null;
      if (!res.ok) {
        throw new RegisterRequestError(
          `OpenRegister ${path} → ${res.status}`,
          res.status,
        );
      }
      return await res.json();
    } catch (error) {
      if (
        error instanceof RegisterCreditError ||
        error instanceof RegisterRequestError
      ) {
        throw error;
      }
      throw new RegisterRequestError(
        `OpenRegister request failed: ${(error as Error).message}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private async post(path: string, body: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (res.status === 429) throw new RegisterCreditError();
      if (!res.ok) {
        throw new RegisterRequestError(
          `OpenRegister ${path} → ${res.status}`,
          res.status,
        );
      }
      return await res.json();
    } catch (error) {
      if (
        error instanceof RegisterCreditError ||
        error instanceof RegisterRequestError
      ) {
        throw error;
      }
      throw new RegisterRequestError(
        `OpenRegister request failed: ${(error as Error).message}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async searchDistressed(
    criteria: DistressedCriteria,
  ): Promise<DistressedSearchResult> {
    const raw = await this.post("/v1/search/company", {
      filters: [
        { field: "status", value: "active" },
        {
          field: "employees",
          min: String(criteria.employeesMin),
          max: String(criteria.employeesMax),
        },
        { field: "net_income", max: "-1" }, // financial loss
      ],
      pagination: { page: criteria.page, per_page: criteria.perPage },
    });
    const parsed = searchResponseSchema.parse(raw);
    const companies: RegisterDistressedCompany[] = parsed.results.map((r) => {
      const fin = extractSearchFinancials(r);
      return {
        companyId: r.company_id,
        name: r.name ?? "",
        registerNumber: r.register_number ?? null,
        registerType: r.register_type ?? null,
        city: r.address?.city ?? null,
        postalCode: r.address?.postal_code ?? null,
        legalForm: r.legal_form ?? null,
        industryCode: firstIndustryCode(r.industry_codes),
        ...fin,
      };
    });
    // Region + legal-form narrowing is not available server-side, so it is
    // applied here over the fetched page (documented in register/filters.ts).
    const filtered = applyDiscoveryFilters(companies, criteria);
    return {
      companies: filtered,
      page: parsed.pagination?.page ?? criteria.page,
      totalPages: parsed.pagination?.total_pages ?? criteria.page,
      totalResults: parsed.pagination?.total_results ?? companies.length,
    };
  }

  async autocomplete(query: string): Promise<RegisterCompanySummary[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const raw = await this.get(
      `/v1/autocomplete/company?query=${encodeURIComponent(trimmed)}`,
    );
    if (raw === null) return [];
    const parsed = autocompleteSchema.parse(raw);
    return parsed.results.map((r) => ({
      companyId: r.company_id,
      name: r.name ?? "",
      registerNumber: r.register_number ?? null,
      registerType: r.register_type ?? null,
      city: r.address?.city ?? null,
    }));
  }

  async getCompany(companyId: string): Promise<RegisterCompanyDetail | null> {
    const raw = await this.get(
      `/v1/company/${encodeURIComponent(companyId)}`,
    );
    if (raw === null) return null;
    return normalizeCompany(companySchema.parse(raw));
  }
}
