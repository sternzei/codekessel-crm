import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import type { ApplicationData } from "./data";

// Real BA form templates (templates/pdf/). Field names were extracted from
// the original AcroForms; the Trägerbescheinigung mapping was verified
// against a real filled example (AZAV/Page3.pdf).
//
// Two applicant paths use the same document pool (see docs/ESERVICE-ANTRAG.md):
//  - "single":  eService "Arbeitsentgeltzuschuss – Antrag" (6 Schritte).
//    Upload: Trägerbescheinigung (ba042369).
//  - "company": eService "Sammelantrag" (7 Schritte). Uploads:
//    Lehrgangskosten-Nachweis, Träger-/Maßnahmezertifikat und die
//    ausgefüllte Teilnehmerliste (BA I FW 501/502).

const TEMPLATE_DIR = path.join(process.cwd(), "templates", "pdf");

export const BA_TEMPLATES = {
  traegerbescheinigung: "traegerbescheinigung_ba042369.pdf",
  teilnehmerliste: "sammelantrag-teilnehmerliste_ba501-502.pdf",
  // Present in templates/pdf but not yet auto-filled (participant-side forms;
  // mappings can be added the same way once the missing data is captured):
  vollmacht: "vollmacht_ba051211.pdf",
  arbeitnehmererklaerung: "arbeitnehmererklaerung_ba042354.pdf",
  fragebogen: "fragebogen_ba046157.pdf",
  schlusserklaerung: "schlusserklaerung_ba042364.pdf",
} as const;

/** Value for a text field, or a radio/checkbox option to select. */
export type BaFieldValue = string | { option: string };

export type BaFormValues = Record<string, BaFieldValue>;

const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
};

/** Splits "Lauchstraße 1" into street + house number (BA forms separate them). */
function splitStreet(raw: string | null | undefined): {
  street: string;
  houseNo: string;
} {
  const value = raw ?? "";
  const match = value.match(/^(.*?)\s+(\d+\S*)$/);
  return match
    ? { street: match[1], houseNo: match[2] }
    : { street: value, houseNo: "" };
}

/** First captured qualification entry, if any (Berufsabschluss-Historie). */
function firstQualification(data: ApplicationData) {
  return data.participant.qualificationHistory?.[0] ?? null;
}

/**
 * Generic AcroForm filler for the real BA templates. Unknown/missing fields
 * are skipped silently — BA revises its forms, so a template update must
 * never crash generation; the review step catches gaps.
 * The form is NOT flattened: the BA expects editable form PDFs.
 */
export async function fillBaForm(
  templateFile: string,
  values: BaFormValues,
): Promise<Uint8Array> {
  const bytes = await readFile(path.join(TEMPLATE_DIR, templateFile));
  const doc = await PDFDocument.load(bytes);
  const form = doc.getForm();

  for (const [name, value] of Object.entries(values)) {
    try {
      if (typeof value === "string") {
        form.getTextField(name).setText(value);
      } else {
        form.getRadioGroup(name).select(value.option);
      }
    } catch {
      // Field missing or of a different type in this template revision.
    }
  }

  return doc.save();
}

// ---------------------------------------------------------------------------
// Trägerbescheinigung (ba042369) — filled by the Bildungsträger, uploaded in
// eService step 3 (single) / step 3 (company: Zertifikate + Bescheinigung).
// ---------------------------------------------------------------------------

export type ProviderInfo = {
  /** Place used for "Ort, Datum" next to the provider signature. */
  city: string;
};

export function buildTraegerbescheinigungValues(
  data: ApplicationData,
  provider: ProviderInfo,
  today: Date = new Date(),
): BaFormValues {
  const p = data.participant;
  const m = data.measure;

  const totalHours =
    m != null ? String(m.durationWeeks * m.weeklyHours) : "";
  const endDate =
    m?.startDate != null
      ? fmtDate(
          new Date(
            new Date(m.startDate).getTime() +
              m.durationWeeks * 7 * 24 * 60 * 60 * 1000,
          ).toISOString(),
        )
      : "";

  return {
    txtf_1_Vorname: p.firstName,
    txtf_2_Nachname: p.lastName,
    txtf_3_Geburtsdatum: fmtDate(p.dateOfBirth),
    txtf_4_Massnahme: m?.name ?? "",
    // "Die Person wurde in die Maßnahme aufgenommen": 0 = ja.
    rbtn_5_Person_in_Massnahme_aufgenommen: { option: "0" },
    // "Maßnahme und Träger sind nach AZAV zugelassen": 0 = ja.
    rbtn_6_zugelassene_Massnahme: { option: "0" },
    txtf_7_Beginn_Massnahme: fmtDate(m?.startDate),
    txtf_8_Ende_Massnahme: endDate,
    txtf_9_Anzahl_Unterrichtsstunden: totalHours,
    txtf_10_Unterrichtszeiten: "",
    // "Führt zu einem Berufsabschluss": 1 = nein (QCG-Anpassungsqualifizierung).
    rbtn_11_Weiterbildung_Berufsabschluss: { option: "1" },
    ...(m?.azavNumber
      ? {
          rbtn_12_Massnahmenummer_vorhanden: { option: "0" as const },
          txtf_13_Massnahmenummer: m.azavNumber,
        }
      : { rbtn_12_Massnahmenummer_vorhanden: { option: "1" as const } }),
    txtf_14_Ort: provider.city,
    txtf_15_Datum: fmtDate(today.toISOString()),
  };
}

// ---------------------------------------------------------------------------
// Anlage zum Sammelantrag — Liste der Teilnehmenden (BA I FW 501/502).
// Company path: one list per employer + measure, up to 18 rows.
// ---------------------------------------------------------------------------

export const TEILNEHMERLISTE_MAX_ROWS = 18;

export type CohortParticipant = {
  firstName: string;
  lastName: string;
  dateOfBirth: string | null;
  /** Sozialversicherungsnummer — not yet captured centrally; blank when null. */
  svNumber?: string | null;
};

export type CohortEmployer = {
  betriebsnummer: string | null;
  street: string | null;
  postalCode: string | null;
  city: string | null;
};

export function buildTeilnehmerlisteValues(
  employer: CohortEmployer,
  measureName: string,
  cohort: CohortParticipant[],
  today: Date = new Date(),
): BaFormValues {
  // Street number split: BA form has separate Str/HausNr fields.
  const { street, houseNo } = splitStreet(employer.street);

  const values: BaFormValues = {
    dateSammelantragVom: fmtDate(today.toISOString()),
    txtfBetriebNr: employer.betriebsnummer ?? "",
    txtfWeiterbildungsmassnahme: measureName,
    txtfBetriebStr: street,
    txtfBetriebHausNr: houseNo,
    txtfBetriebPlz: employer.postalCode ?? "",
    txtfBetriebOrt: employer.city ?? "",
    // Arbeitsverhältnis besteht während der Weiterbildung fort: 0 = ja.
    rbtnPersonWeiterbildungArbeitsverhaeltnis: { option: "0" },
    // Keine vorzeitige Beendigung bekannt: 1 = nein.
    rbtnPersonWeiterbildungVorzeitigBeendet: { option: "1" },
  };

  cohort.slice(0, TEILNEHMERLISTE_MAX_ROWS).forEach((person, index) => {
    const n = index + 1;
    values[`txtfTabTeilnehmerPerson${n}SVNummer`] = person.svNumber ?? "";
    values[`txtfTabTeilnehmerPerson${n}Vorname`] = person.firstName;
    values[`txtfTabTeilnehmerPerson${n}Nachname`] = person.lastName;
    values[`dateTabTeilnehmerPerson${n}GebDatum`] = fmtDate(person.dateOfBirth);
  });

  return values;
}

// ---------------------------------------------------------------------------
// Arbeitnehmererklärung (ba042354) — the employee's declaration, single-upload
// path. 16 fields; verified against templates/pdf/arbeitnehmererklaerung_
// ba042354.pdf. Betriebs-fields = the employer (Betrieb) the person works at.
// Fields we do not capture (GdB, ungelernte Tätigkeit, Bedarfsgemeinschaft)
// are left blank for the employee to complete by hand.
// ---------------------------------------------------------------------------

export function buildArbeitnehmererklaerungValues(
  data: ApplicationData,
  today: Date = new Date(),
): BaFormValues {
  const p = data.participant;
  const e = data.employer;
  const qual = firstQualification(data);
  const { street, houseNo } = splitStreet(e?.street);

  const values: BaFormValues = {
    txtf_Vorname: p.firstName,
    txtf_Nachname: p.lastName,
    txtf_Geburtsdatum: fmtDate(p.dateOfBirth),
    txtf_Betriebsbezeichnung: e?.companyName ?? "",
    txtf_Strasse: street,
    txtf_Hausnummer: houseNo,
    txtf_PLZ: e?.postalCode ?? "",
    txtf_Ort: e?.city ?? "",
    txtf_OrtU: p.city ?? "",
    txtf_Datum: fmtDate(today.toISOString()),
    // "Berufsabschluss vorhanden?" — ja when a qualification is on file.
    rbtn_Berufsabschluss_vorhanden: qual
      ? { option: "ja" }
      : { option: "nein (weiter mit 13)" },
  };

  if (qual) {
    values.txtf_Berufsabschluss_Berufsbezeichnung = qual.beruf;
    values.txtf_Zeugnisdatum = fmtDate(qual.abschlussdatum);
  }

  return values;
}
