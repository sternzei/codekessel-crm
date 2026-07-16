import type {
  DistressedCriteria,
  DistressedSearchResult,
  RegisterCompanyDetail,
  RegisterCompanySummary,
  RegisterProvider,
} from "./types";

// Demo-safe register source used whenever OPENREGISTER_API_KEY is unset. It
// makes zero network calls and burns zero credits, so local/demo runs of the
// admin import flow work end-to-end without a live key.

const FIXTURES: RegisterCompanyDetail[] = [
  {
    companyId: "DE-HRB-DEMO-100001",
    name: "Muster Pflegedienst GmbH",
    legalForm: "gmbh",
    registerNumber: "100001",
    registerType: "HRB",
    registerCourt: "München",
    status: "active",
    incorporatedAt: "2015-03-01",
    address: { street: "Musterstraße 1", postalCode: "80331", city: "München" },
    industryCode: "86.10.0",
    contact: { email: null, phone: null, website: "https://muster-pflege.example" },
    representatives: [
      {
        name: "Anna Beispiel",
        firstName: "Anna",
        lastName: "Beispiel",
        role: "DIRECTOR",
        city: "München",
        isManagingDirector: true,
      },
      {
        name: "Karl Prokura",
        firstName: "Karl",
        lastName: "Prokura",
        role: "PROKURA",
        city: "München",
        isManagingDirector: false,
      },
    ],
  },
  {
    companyId: "DE-HRB-DEMO-100002",
    name: "Beispiel Handwerk UG (haftungsbeschränkt)",
    legalForm: "ug",
    registerNumber: "100002",
    registerType: "HRB",
    registerCourt: "Berlin",
    status: "active",
    incorporatedAt: "2019-09-15",
    address: { street: "Beispielweg 7", postalCode: "10115", city: "Berlin" },
    industryCode: "43.31.0",
    contact: { email: null, phone: null, website: null },
    representatives: [
      {
        name: "Mehmet Muster",
        firstName: "Mehmet",
        lastName: "Muster",
        role: "DIRECTOR",
        city: "Berlin",
        isManagingDirector: true,
      },
    ],
  },
];

export class MockRegisterProvider implements RegisterProvider {
  readonly mode = "mock" as const;

  async searchDistressed(
    criteria: DistressedCriteria,
  ): Promise<DistressedSearchResult> {
    // Demo-safe: return the fixtures as loss-making companies, first page only.
    const companies = FIXTURES.map((c, i) => ({
      companyId: c.companyId,
      name: c.name,
      registerNumber: c.registerNumber,
      registerType: c.registerType,
      city: c.address.city,
      legalForm: c.legalForm,
      profitEur: i === 0 ? -84_000 : -21_500,
      revenueEur: i === 0 ? 1_250_000 : 430_000,
      fiscalYear: "2024",
      employees: i === 0 ? 24 : 12,
      financialsSource: "search_row" as const,
    }));
    return {
      companies: criteria.page > 1 ? [] : companies,
      page: criteria.page,
      totalPages: 1,
      totalResults: companies.length,
    };
  }

  async autocomplete(query: string): Promise<RegisterCompanySummary[]> {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return FIXTURES.filter((c) => c.name.toLowerCase().includes(q) || true).map(
      (c) => ({
        companyId: c.companyId,
        name: c.name,
        registerNumber: c.registerNumber,
        registerType: c.registerType,
        city: c.address.city,
      }),
    );
  }

  async getCompany(companyId: string): Promise<RegisterCompanyDetail | null> {
    return FIXTURES.find((c) => c.companyId === companyId) ?? null;
  }
}
