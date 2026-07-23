// Normalized OpenRegister DTOs. The raw API response is large and snake_cased;
// everything the app consumes is mapped into these camelCased shapes at the
// adapter boundary so the rest of the codebase never touches the wire format.

export type RegisterCompanySummary = {
  companyId: string; // e.g. "DE-HRB-D2601-281581" — the id used for detail
  name: string;
  registerNumber: string | null;
  registerType: string | null;
  city: string | null;
};

export type RegisterRepresentative = {
  name: string;
  firstName: string | null;
  lastName: string | null;
  role: string; // raw register role, e.g. "DIRECTOR", "PROKURA"
  city: string | null;
  // Derived: a currently-active managing director / Geschäftsführer / Vorstand.
  // These are the natural persons worth turning into a lead.
  isManagingDirector: boolean;
};

export type RegisterCompanyDetail = {
  companyId: string;
  name: string;
  legalForm: string | null;
  registerNumber: string | null;
  registerType: string | null;
  registerCourt: string | null;
  status: string | null;
  incorporatedAt: string | null;
  address: {
    street: string | null;
    postalCode: string | null;
    city: string | null;
  };
  industryCode: string | null; // first WZ code, if any
  contact: {
    email: string | null;
    phone: string | null;
    website: string | null;
  };
  // Only *current* mandates (no end_date), managing directors first. Former
  // officers are dropped — importing someone who left years ago is a bug.
  representatives: RegisterRepresentative[];
};

/**
 * A register data source. Implemented by the live OpenRegister adapter and a
 * demo-safe mock. Admin-only callers depend on this interface, not the vendor.
 */
// Server-side discovery criteria. The register filters loss-makers server-side
// (net_income < 0), so every returned company is already financially distressed
// — the exact target profile for AZAV outreach (mirrors the streamlined
// lead-gen pipeline: active + employees 10–50 + net_income < 0).
export type DistressedCriteria = {
  employeesMin: number;
  employeesMax: number;
  page: number;
  perPage: number;
  // Optional discovery narrowing. OpenRegister exposes no confirmed server-side
  // filter for federal state, legal form, or industry, so these are all applied
  // CLIENT-SIDE after the fetch (see register/filters.ts). An empty
  // federalState ("") means "all regions"; an empty legalForms array means "all
  // legal forms"; an empty industryCodes array means "all industries".
  federalState?: string;
  legalForms?: string[];
  // NACE/WZ (Branche) division prefixes to keep, matched against the company's
  // best-effort industry code by leading digits (e.g. "86" keeps "86.10.0").
  industryCodes?: string[];
};

// Where a company's figures were read from — also records their original
// unit: OpenRegister reports `indicators[]` monetary values in cents, while
// flat search-row fields (`net_income`/`revenue`) are already in euros.
export type FinancialsSource = "indicators" | "search_row";

export type RegisterDistressedCompany = {
  companyId: string;
  name: string;
  registerNumber: string | null;
  registerType: string | null;
  city: string | null;
  // Best-effort from the search payload — used for client-side federal-state
  // filtering (PLZ prefix). May be null when the search row omits an address.
  postalCode: string | null;
  legalForm: string | null;
  // Best-effort NACE/WZ code from the search payload — used for client-side
  // industry (Branche) filtering. May be null when the row omits it.
  industryCode: string | null;
  // Best-effort from the search payload — may be absent even though the
  // server-side net_income<0 filter guarantees the company is loss-making.
  // A loss is a negative profit; missing figures stay null (never 0).
  profitEur: number | null;
  revenueEur: number | null;
  fiscalYear: string | null;
  employees: number | null;
  // Provenance + unit origin of the figures above, null when none were found.
  financialsSource: FinancialsSource | null;
};

export type DistressedSearchResult = {
  companies: RegisterDistressedCompany[];
  page: number;
  totalPages: number;
  totalResults: number;
};

export interface RegisterProvider {
  readonly mode: "live" | "mock";
  /**
   * Primary discovery: financially distressed companies matching the criteria
   * (10 credits per page). This is the real lead-gen motion — targeting small
   * loss-making companies, not searching by name.
   */
  searchDistressed(criteria: DistressedCriteria): Promise<DistressedSearchResult>;
  /** Cheap company lookup by name (1 credit live) — manual/ad-hoc search. */
  autocomplete(query: string): Promise<RegisterCompanySummary[]>;
  /** Full company record incl. current representatives (10 credits live). */
  getCompany(companyId: string): Promise<RegisterCompanyDetail | null>;
}

/** HTTP 429 or an exhausted credit/rate cap — callers should back off. */
export class RegisterCreditError extends Error {
  constructor(message = "OpenRegister rate limit or credit cap reached") {
    super(message);
    this.name = "RegisterCreditError";
  }
}

/** Any other non-success response or transport failure. */
export class RegisterRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "RegisterRequestError";
  }
}
