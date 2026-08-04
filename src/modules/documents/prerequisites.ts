import type { ApplicationData } from "./data";

// Which central fields each document needs before it can be filled in.
//
// This lives apart from actions.ts because that file is a "use server" module
// and may only export async functions — the checklist page has to read the
// same catalogue to warn BEFORE a consultant presses a button, rather than
// leaving them with an empty row afterwards.

/** Labels are shown to consultants verbatim, so they name the field on screen. */
const REQUIREMENT_LABELS = {
  employer: "Arbeitgeber",
  measure: "Maßnahme",
  measureStartDate: "Maßnahmebeginn",
  measureCost: "Lehrgangskosten",
  dateOfBirth: "Geburtsdatum",
  street: "Straße",
} as const;

type Requirement = keyof typeof REQUIREMENT_LABELS;

const isPresent: Record<Requirement, (data: ApplicationData) => boolean> = {
  employer: (data) => Boolean(data.employer),
  measure: (data) => Boolean(data.measure),
  measureStartDate: (data) => Boolean(data.measure?.startDate),
  measureCost: (data) => Boolean(data.measure?.costEur),
  dateOfBirth: (data) => Boolean(data.participant.dateOfBirth),
  street: (data) => Boolean(data.participant.street),
};

export const DOCUMENT_REQUIREMENTS = {
  traegerbescheinigung: ["measureStartDate"],
  eservice_single: ["employer", "measure"],
  arbeitnehmererklaerung: ["employer"],
  vollmacht: ["employer"],
  fragebogen: ["measure"],
  teilnehmerliste: ["employer", "measure"],
  eservice_company: ["employer", "measure"],
  participant_form: ["measure", "dateOfBirth", "street"],
  cost_overview: ["measureCost"],
  employer_datasheet: ["employer"],
} as const satisfies Record<string, readonly Requirement[]>;

export type DocumentType = keyof typeof DOCUMENT_REQUIREMENTS;

export const isDocumentType = (value: string): value is DocumentType =>
  value in DOCUMENT_REQUIREMENTS;

/** Empty means the document can be generated. */
export const findMissingDocumentData = (
  type: DocumentType,
  data: ApplicationData,
): readonly string[] =>
  DOCUMENT_REQUIREMENTS[type]
    .filter((requirement) => !isPresent[requirement](data))
    .map((requirement) => REQUIREMENT_LABELS[requirement]);

export const describeMissingData = (missing: readonly string[]): string =>
  `Es fehlt: ${missing.join(", ")}`;
