import type { DistressedCriteria, RegisterDistressedCompany } from "./types";

// Client-side discovery filters for OpenRegister results.
//
// OpenRegister's /v1/search/company request supports the server-side filters we
// already send (status=active, employees range, net_income<0). It exposes no
// documented/confirmed filter field for federal state or legal form, and the
// search rows we can rely on only carry `address.city` (+ optional
// postal_code) and `legal_form`. So — per the "do not invent API fields" rule —
// both criteria are applied CLIENT-SIDE, after the fetch, over the returned
// page. Note: this narrows the current page only; the reported total counts
// still reflect the server-side filters.

// Sentinel meaning "no federal-state narrowing" (all regions).
export const ALL_FEDERAL_STATES = "";

// The default target region for AZAV outreach. Configurable here (and via the
// import UI), never hard-coded at the call sites.
export const DEFAULT_FEDERAL_STATE = "baden-wuerttemberg";

// Federal state → the 2-digit postal-code prefixes that fall in it. APPROXIMATE
// (a handful of border PLZ straddle two states) and intentionally the single
// place to extend/adjust the mapping. Baden-Württemberg (the default target) is
// specified in full; the rest are best-effort and easily completed.
export const FEDERAL_STATE_POSTAL_PREFIXES: Record<string, readonly string[]> = {
  "baden-wuerttemberg": [
    "68", "69", "70", "71", "72", "73", "74", "75", "76", "77", "78", "79",
    "88", "89",
  ],
  bayern: [
    "80", "81", "82", "83", "84", "85", "86", "87", "90", "91", "92", "93",
    "94", "95", "96", "97",
  ],
  berlin: ["10", "12", "13", "14"],
  brandenburg: ["03", "14", "15", "16", "17"],
  bremen: ["27", "28"],
  hamburg: ["20", "21", "22"],
  hessen: ["34", "35", "36", "60", "61", "63", "64", "65"],
  "niedersachsen": ["26", "27", "28", "29", "30", "31", "37", "38"],
  "nordrhein-westfalen": [
    "32", "33", "40", "41", "42", "44", "45", "46", "47", "48", "49", "50",
    "51", "52", "53", "57", "58", "59",
  ],
  "rheinland-pfalz": ["54", "55", "56", "66", "67", "76"],
  saarland: ["66"],
  sachsen: ["01", "02", "04", "08", "09"],
  "sachsen-anhalt": ["06", "38", "39"],
  "schleswig-holstein": ["22", "23", "24", "25"],
  thueringen: ["07", "98", "99"],
  "mecklenburg-vorpommern": ["17", "18", "19", "23"],
};

// Human-readable labels for the import UI select.
export const FEDERAL_STATE_LABELS: Record<string, string> = {
  "baden-wuerttemberg": "Baden-Württemberg",
  bayern: "Bayern",
  berlin: "Berlin",
  brandenburg: "Brandenburg",
  bremen: "Bremen",
  hamburg: "Hamburg",
  hessen: "Hessen",
  "niedersachsen": "Niedersachsen",
  "nordrhein-westfalen": "Nordrhein-Westfalen",
  "rheinland-pfalz": "Rheinland-Pfalz",
  saarland: "Saarland",
  sachsen: "Sachsen",
  "sachsen-anhalt": "Sachsen-Anhalt",
  "schleswig-holstein": "Schleswig-Holstein",
  thueringen: "Thüringen",
  "mecklenburg-vorpommern": "Mecklenburg-Vorpommern",
};

// Legal-form codes offered in the import UI, matched against the search row's
// `legal_form` (case-insensitive). Configurable list, not hard-coded inline.
export const LEGAL_FORM_OPTIONS: readonly { value: string; label: string }[] = [
  { value: "gmbh", label: "GmbH" },
  { value: "ug", label: "UG (haftungsbeschränkt)" },
  { value: "ag", label: "AG" },
  { value: "kg", label: "KG" },
  { value: "gmbh_co_kg", label: "GmbH & Co. KG" },
  { value: "ohg", label: "OHG" },
  { value: "gbr", label: "GbR" },
  { value: "ev", label: "e.V." },
];

// Industry (Branche) options offered in the import UI, keyed by the leading
// NACE/WZ **division** digits, matched by prefix against the company's
// best-effort industry code (e.g. selecting "86" keeps "86.10.0"). Configurable
// list, not hard-coded at the call sites; extend as new target sectors appear.
export const INDUSTRY_OPTIONS: readonly { value: string; label: string }[] = [
  { value: "86", label: "Gesundheitswesen" },
  { value: "87", label: "Pflege-/Wohnheime" },
  { value: "88", label: "Sozialwesen (ohne Heime)" },
  { value: "41", label: "Hochbau" },
  { value: "43", label: "Vorbereitende Baustellenarbeiten / Ausbau" },
  { value: "49", label: "Landverkehr / Logistik" },
  { value: "56", label: "Gastronomie" },
  { value: "81", label: "Gebäudebetreuung / Reinigung" },
];

/**
 * True when a company's postal code falls in the selected federal state. An
 * empty/absent state means "all regions" (always true). A state with no
 * configured prefixes is treated as un-narrowed (true) rather than silently
 * dropping every result. A company without a postal code cannot be classified,
 * so it is excluded when a specific, configured state is chosen.
 */
export function matchesFederalState(
  postalCode: string | null,
  federalState: string,
): boolean {
  if (!federalState) return true;
  const prefixes = FEDERAL_STATE_POSTAL_PREFIXES[federalState];
  if (!prefixes) return true;
  if (!postalCode) return false;
  return prefixes.includes(postalCode.trim().slice(0, 2));
}

/**
 * True when a company's legal form is one of the selected forms. An empty
 * selection means "all forms". A company with no legal form is excluded when a
 * specific selection is active.
 */
export function matchesLegalForm(
  legalForm: string | null,
  allowed: readonly string[],
): boolean {
  if (!allowed || allowed.length === 0) return true;
  if (!legalForm) return false;
  const wanted = allowed.map((a) => a.toLowerCase());
  return wanted.includes(legalForm.toLowerCase());
}

/**
 * True when a company's industry falls under one of the selected NACE/WZ
 * division prefixes. An empty selection means "all industries". A company with
 * no industry code is excluded when a specific selection is active. Matching is
 * by leading digits, so a 2-digit division ("86") keeps any sub-class
 * ("86.10.0", "86.90.9") beneath it.
 */
export function matchesIndustry(
  industryCode: string | null,
  allowed: readonly string[],
): boolean {
  if (!allowed || allowed.length === 0) return true;
  if (!industryCode) return false;
  const code = industryCode.trim();
  return allowed.some((prefix) => code.startsWith(prefix.trim()));
}

/**
 * Narrows a fetched discovery page by the optional federal-state, legal-form,
 * and industry criteria. Pure — no network — so both providers and the UI share
 * one rule.
 */
export function applyDiscoveryFilters(
  companies: readonly RegisterDistressedCompany[],
  criteria: Pick<
    DistressedCriteria,
    "federalState" | "legalForms" | "industryCodes"
  >,
): RegisterDistressedCompany[] {
  const federalState = criteria.federalState ?? ALL_FEDERAL_STATES;
  const legalForms = criteria.legalForms ?? [];
  const industryCodes = criteria.industryCodes ?? [];
  return companies.filter(
    (c) =>
      matchesFederalState(c.postalCode, federalState) &&
      matchesLegalForm(c.legalForm, legalForms) &&
      matchesIndustry(c.industryCode, industryCodes),
  );
}
