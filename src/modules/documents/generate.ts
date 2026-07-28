import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { buildStorageKey, getStorage } from "@/modules/storage";
import {
  BA_TEMPLATES,
  buildArbeitnehmererklaerungValues,
  buildFragebogenValues,
  buildTeilnehmerlisteValues,
  buildTraegerbescheinigungValues,
  buildVollmachtValues,
  fillBaForm,
  type CohortParticipant,
} from "./ba-forms";
import type { ApplicationData } from "./data";

// PDF layer. Two modes, matching the concept's §9:
//  A) Autofill: fillable AcroForm templates (real BA forms drop into
//     templates/pdf/ later — until then a generated SAMPLE template proves
//     the engine; content is clearly marked PLATZHALTER).
//  B) Generation: documents we own (cost overview, employer data sheet)
//     drawn directly with pdf-lib.

// Bundled, read-only form templates ship with the app, so they stay on the
// local filesystem. Only participant uploads + generated/signed artifacts go
// through the durable storage adapter.
const TEMPLATE_DIR = path.join(process.cwd(), "templates", "pdf");

const SAMPLE_TEMPLATE = "teilnehmer-stammblatt";

// Mapping: AcroForm field name → flat data key. Real BA mappings will be
// provided as <form-key>.mapping.json next to each form.
const SAMPLE_MAPPING: Record<string, string> = {
  vorname: "firstName",
  nachname: "lastName",
  geburtsdatum: "dateOfBirth",
  strasse: "street",
  plz_ort: "postalCodeCity",
  telefon: "phone",
  email: "email",
  massnahme: "measureName",
  azav_nummer: "azavNumber",
  beginn: "startDate",
};

export function flattenParticipantData(
  data: ApplicationData,
): Record<string, string> {
  const p = data.participant;
  return {
    firstName: p.firstName,
    lastName: p.lastName,
    dateOfBirth: p.dateOfBirth ?? "",
    street: p.street ?? "",
    postalCodeCity: [p.postalCode, p.city].filter(Boolean).join(" "),
    phone: p.phone ?? "",
    email: p.email ?? "",
    measureName: data.measure?.name ?? "",
    azavNumber: data.measure?.azavNumber ?? "",
    startDate: data.measure?.startDate ?? "",
  };
}

/** Creates the sample fillable template once (stand-in for real BA forms). */
export async function ensureSampleTemplate(): Promise<string> {
  await mkdir(TEMPLATE_DIR, { recursive: true });
  const filePath = path.join(TEMPLATE_DIR, `${SAMPLE_TEMPLATE}.pdf`);
  try {
    await readFile(filePath);
    return filePath;
  } catch {
    // fall through and create it
  }

  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]); // A4
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const form = doc.getForm();

  page.drawText("MUSTER — Teilnehmer-Stammblatt (PLATZHALTER)", {
    x: 50,
    y: 790,
    size: 14,
    font: bold,
  });
  page.drawText(
    "Dieses Formular ist ein technisches Muster. Es ersetzt kein Formular der Bundesagentur für Arbeit.",
    { x: 50, y: 770, size: 8, font, color: rgb(0.6, 0.1, 0.1) },
  );

  let y = 720;
  for (const fieldName of Object.keys(SAMPLE_MAPPING)) {
    page.drawText(fieldName.replaceAll("_", " "), { x: 50, y: y + 4, size: 9, font });
    const field = form.createTextField(fieldName);
    field.addToPage(page, { x: 180, y: y - 6, width: 320, height: 20 });
    y -= 44;
  }

  await writeFile(filePath, await doc.save());
  return filePath;
}

// `relativePath` is the durable storage key persisted on the document row.
export type GeneratedFile = { relativePath: string; sha256: string };

async function persist(bytes: Uint8Array): Promise<GeneratedFile> {
  const relativePath = await getStorage().put({
    key: buildStorageKey({ prefix: "documents", extension: "pdf" }),
    bytes,
    contentType: "application/pdf",
  });
  return {
    relativePath,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

/** Mode A: fill the sample AcroForm template from central data. */
export async function generateParticipantForm(
  data: ApplicationData,
): Promise<GeneratedFile> {
  const templatePath = await ensureSampleTemplate();
  const doc = await PDFDocument.load(await readFile(templatePath));
  const form = doc.getForm();
  const flat = flattenParticipantData(data);

  for (const [fieldName, dataKey] of Object.entries(SAMPLE_MAPPING)) {
    form.getTextField(fieldName).setText(flat[dataKey] ?? "");
  }
  form.flatten();

  return persist(await doc.save());
}

// ---- Real BA forms (Mode A on original AcroForms) ------------------------

/** Provider = the Bildungsträger operating this platform (Zertifikate liegen
 * in templates/documents/). City is used for "Ort, Datum" on ba042369. */
const PROVIDER_CITY = process.env.PROVIDER_CITY ?? "Böblingen";
/** Bildungsträger name printed as "Name des Maßnahmeträgers" on BA forms. */
const PROVIDER_NAME = process.env.PROVIDER_NAME ?? "codeKessel Inh. Ugur Karatas";

/**
 * Trägerbescheinigung (ba042369) — required upload for the SINGLE eService
 * path (step 3) and part of the company package. Editable AcroForm; the
 * Träger signature stays a wet/canvas signature on the printed field.
 */
export async function generateTraegerbescheinigung(
  data: ApplicationData,
): Promise<GeneratedFile> {
  const bytes = await fillBaForm(
    BA_TEMPLATES.traegerbescheinigung,
    buildTraegerbescheinigungValues(data, { city: PROVIDER_CITY }),
  );
  return persist(bytes);
}

/**
 * Anlage zum Sammelantrag — Liste der Teilnehmenden (BA I FW 501/502).
 * COMPANY path, step 4 upload. One list covers every participant of the
 * same employer + measure (max 18 rows per form).
 */
export async function generateTeilnehmerliste(
  data: ApplicationData,
  cohort: CohortParticipant[],
): Promise<GeneratedFile> {
  const bytes = await fillBaForm(
    BA_TEMPLATES.teilnehmerliste,
    buildTeilnehmerlisteValues(
      {
        betriebsnummer: data.employer?.betriebsnummer ?? null,
        street: data.employer?.street ?? null,
        postalCode: data.employer?.postalCode ?? null,
        city: data.employer?.city ?? null,
      },
      data.measure?.name ?? "",
      // svNumber now flows from collectCompanyCohort (Epic A); still blank for
      // any participant whose number has not been captured yet.
      cohort,
    ),
  );
  return persist(bytes);
}

/**
 * Arbeitnehmererklärung (ba042354) — the employee's declaration, uploaded on
 * the single path. Editable AcroForm; the employee signs the printed field.
 */
export async function generateArbeitnehmererklaerung(
  data: ApplicationData,
): Promise<GeneratedFile> {
  const bytes = await fillBaForm(
    BA_TEMPLATES.arbeitnehmererklaerung,
    buildArbeitnehmererklaerungValues(data),
  );
  return persist(bytes);
}

/**
 * Vollmacht (ba051211) — power of attorney, participant-signed. Editable
 * AcroForm autofilled from central data; the participant signs the drawn field.
 */
export async function generateVollmacht(
  data: ApplicationData,
): Promise<GeneratedFile> {
  const bytes = await fillBaForm(
    BA_TEMPLATES.vollmacht,
    buildVollmachtValues(data),
  );
  return persist(bytes);
}

/**
 * Teilnehmer-Fragebogen (ba046157) — participant questionnaire. Editable
 * AcroForm autofilled from central data; the travel/childcare annex stays
 * blank (not collected here) and is completed by hand if ever needed.
 */
export async function generateFragebogen(
  data: ApplicationData,
): Promise<GeneratedFile> {
  const bytes = await fillBaForm(
    BA_TEMPLATES.fragebogen,
    buildFragebogenValues(data, { name: PROVIDER_NAME }),
  );
  return persist(bytes);
}

/** Mode B: generated summary documents (cost overview, employer sheet). */
export async function generateSummaryPdf(
  title: string,
  sections: { heading: string; rows: [string, string][] }[],
): Promise<GeneratedFile> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  page.drawText(title, { x: 50, y: 790, size: 16, font: bold });
  page.drawText(
    `Erstellt am ${new Date().toLocaleDateString("de-DE")} — PLATZHALTER, kein amtliches Dokument`,
    { x: 50, y: 772, size: 8, font, color: rgb(0.45, 0.45, 0.45) },
  );

  let y = 730;
  for (const section of sections) {
    page.drawText(section.heading, { x: 50, y, size: 12, font: bold });
    y -= 20;
    for (const [label, value] of section.rows) {
      page.drawText(label, { x: 50, y, size: 10, font, color: rgb(0.35, 0.35, 0.35) });
      page.drawText(value || "—", { x: 220, y, size: 10, font });
      y -= 16;
    }
    y -= 14;
  }

  return persist(await doc.save());
}

export async function generateCostOverview(
  data: ApplicationData,
): Promise<GeneratedFile> {
  const m = data.measure;
  return generateSummaryPdf("Kostenübersicht Weiterbildungsmaßnahme", [
    {
      heading: "Maßnahme",
      rows: [
        ["Bezeichnung", m?.name ?? ""],
        ["AZAV-Maßnahmennummer", m?.azavNumber ?? ""],
        ["Format", m?.format ?? ""],
        ["Dauer", m ? `${m.durationWeeks} Wochen à ${m.weeklyHours} Std./Woche` : ""],
        ["Beginn", m?.startDate ?? ""],
      ],
    },
    {
      heading: "Kosten",
      rows: [
        ["Lehrgangskosten gesamt", m?.costEur ? `${m.costEur} EUR` : ""],
        ["Kostenträger", "Agentur für Arbeit (bei Bewilligung) — PLATZHALTER"],
      ],
    },
    {
      heading: "Teilnehmer:in",
      rows: [
        ["Name", `${data.participant.firstName} ${data.participant.lastName}`],
        ["Arbeitgeber", data.employer?.companyName ?? ""],
      ],
    },
  ]);
}

// ---- Signed artifact (stamp + audit certificate) ------------------------

export type SignatureStamp = {
  signerKind: string;
  signerName: string;
  signedAt: Date;
  ipAddress: string;
  provider: string;
  /** Storage key of the drawn signature PNG (canvas provider). */
  imagePath: string | null;
};

const SIGNER_LABEL: Record<string, string> = {
  participant: "Teilnehmer:in",
  employer: "Arbeitgeber",
  internal_user: "Intern",
};

/**
 * Produces the signed PDF once every required signature is collected: stamps
 * each drawn signature into the last-page footer band AND appends an
 * "Unterschriften-Nachweis" (SES audit) page. The original file stays
 * untouched — `originalSha256` is what was actually signed and is cited on
 * the certificate.
 */
export async function generateSignedArtifact(params: {
  originalRelativePath: string;
  documentTitle: string;
  originalSha256: string;
  signatures: SignatureStamp[];
}): Promise<GeneratedFile> {
  const storage = getStorage();
  const doc = await PDFDocument.load(await storage.get(params.originalRelativePath));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const fmt = (d: Date) =>
    d.toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });

  // Load signature images once (reused for footer stamp + certificate).
  const images = await Promise.all(
    params.signatures.map(async (s) => {
      if (!s.imagePath) return null;
      try {
        return await doc.embedPng(await storage.get(s.imagePath));
      } catch {
        return null;
      }
    }),
  );

  // Stamp into the footer band of the last content page.
  const pages = doc.getPages();
  const lastPage = pages[pages.length - 1];
  let stampX = 50;
  const stampY = 60;
  for (let i = 0; i < params.signatures.length; i += 1) {
    const s = params.signatures[i];
    const img = images[i];
    if (img) {
      const w = 120;
      const h = (img.height / img.width) * w;
      lastPage.drawImage(img, { x: stampX, y: stampY, width: w, height: Math.min(h, 40) });
    }
    lastPage.drawText(
      `${SIGNER_LABEL[s.signerKind] ?? s.signerKind}: ${s.signerName}`,
      { x: stampX, y: stampY - 10, size: 7, font },
    );
    lastPage.drawText(fmt(s.signedAt), { x: stampX, y: stampY - 19, size: 7, font, color: rgb(0.4, 0.4, 0.4) });
    stampX += 170;
  }

  // Append the audit certificate page.
  const cert = doc.addPage([595, 842]);
  cert.drawText("Unterschriften-Nachweis", { x: 50, y: 790, size: 16, font: bold });
  cert.drawText(
    "Einfache elektronische Signatur (eIDAS SES) — PLATZHALTER, rechtliche Prüfung ausstehend",
    { x: 50, y: 772, size: 8, font, color: rgb(0.45, 0.45, 0.45) },
  );
  cert.drawText(`Dokument: ${params.documentTitle}`, { x: 50, y: 740, size: 10, font });
  cert.drawText(`SHA-256 (signierter Originalinhalt): ${params.originalSha256}`, {
    x: 50,
    y: 724,
    size: 7,
    font,
    color: rgb(0.35, 0.35, 0.35),
  });

  let y = 690;
  for (let i = 0; i < params.signatures.length; i += 1) {
    const s = params.signatures[i];
    const img = images[i];
    cert.drawText(SIGNER_LABEL[s.signerKind] ?? s.signerKind, { x: 50, y, size: 11, font: bold });
    y -= 16;
    for (const [label, value] of [
      ["Name", s.signerName],
      ["Signiert am", fmt(s.signedAt)],
      ["IP-Adresse", s.ipAddress],
      ["Verfahren", s.provider],
    ] as [string, string][]) {
      cert.drawText(label, { x: 50, y, size: 9, font, color: rgb(0.4, 0.4, 0.4) });
      cert.drawText(value || "—", { x: 170, y, size: 9, font });
      y -= 14;
    }
    if (img) {
      const w = 120;
      const h = Math.min((img.height / img.width) * w, 40);
      cert.drawImage(img, { x: 170, y: y - h, width: w, height: h });
      y -= h + 8;
    }
    y -= 18;
  }

  return persist(await doc.save());
}

// ---- eService companion sheets -------------------------------------------
// The BA eService replaces the big AEZ form: the same answers are typed into
// the online portal (single: 6 steps, company/Sammelantrag: 7 steps). These
// sheets present every step's answers from central data so the consultant
// can copy them in — plus the upload checklist per step.

const yesNo = (v: boolean | null | undefined): string =>
  v == null ? "" : v ? "Ja" : "Nein";

export async function generateEServiceCompanionSingle(
  data: ApplicationData,
): Promise<GeneratedFile> {
  const p = data.participant;
  const e = data.employer;
  const m = data.measure;
  return generateSummaryPdf(
    "eService-Begleitblatt — Arbeitsentgeltzuschuss (Einzelantrag, 6 Schritte)",
    [
      {
        heading: "Schritt 1 — Allgemeine Angaben (Betrieb)",
        rows: [
          ["Name des Betriebs", e?.companyName ?? ""],
          ["Betriebsnummer", e?.betriebsnummer ?? ""],
          ["Anschrift", [e?.street, e?.postalCode, e?.city].filter(Boolean).join(", ")],
          ["Ansprechperson", e?.contactName ?? ""],
          ["E-Mail / Telefon", [e?.contactEmail, e?.contactPhone].filter(Boolean).join(" / ")],
          ["IBAN Geschäftskonto", "— (nicht zentral erfasst)"],
        ],
      },
      {
        heading: "Schritt 2 — Betriebsgröße",
        rows: [
          ["Beschäftigte gesamt", e?.employeeCount?.toString() ?? ""],
          ["Betriebsvereinbarung/Tarifvertrag Weiterbildung", "— (nicht zentral erfasst)"],
        ],
      },
      {
        heading: "Schritt 3 — Weiterbildung (Upload: Trägerbescheinigung!)",
        rows: [
          ["Name des Bildungsträgers", "codeKessel Inh. Ugur Karatas"],
          ["Bezeichnung der Weiterbildung", m?.name ?? ""],
          ["AZAV-zugelassen (§§ 176 ff. SGB III)", "Ja"],
          ["Mehr als 120 Stunden", m ? yesNo(m.durationWeeks * m.weeklyHours > 120) : ""],
          ["Beginn / Ende", m?.startDate ? `${m.startDate} / +${m.durationWeeks} Wochen` : ""],
          ["Umfang in Stunden", m ? String(m.durationWeeks * m.weeklyHours) : ""],
          ["Schulungszeiten (Uhrzeiten)", "— (nicht zentral erfasst)"],
        ],
      },
      {
        heading: "Schritt 4 — Angaben zur beschäftigten Person",
        rows: [
          ["Vorname / Nachname", `${p.firstName} ${p.lastName}`],
          ["Geburtsdatum", p.dateOfBirth ?? ""],
          ["SV-Arbeitsverhältnis besteht fort", yesNo(p.availabilityStatus === "yes" ? true : null)],
          ["Vertragliche Arbeitszeit / Verteilung", "— (nicht zentral erfasst)"],
          ["Freistellungsstunden", "— (nicht zentral erfasst)"],
          ["Gehalt / Vergütungsart", "— (nicht zentral erfasst)"],
          ["KuG / EGZ / anderer Zuschuss", "— (nicht zentral erfasst)"],
        ],
      },
      {
        heading: "Schritt 5–6 — Prüfen & Zustimmung",
        rows: [
          ["Daten überprüfen", "im Portal"],
          ["3 Bestätigungen (Hinweise, Erklärung, Richtigkeit)", "im Portal ankreuzen"],
        ],
      },
    ],
  );
}

export async function generateEServiceCompanionCompany(
  data: ApplicationData,
  cohortSize: number,
): Promise<GeneratedFile> {
  const e = data.employer;
  const m = data.measure;
  return generateSummaryPdf(
    "eService-Begleitblatt — Sammelantrag (Firma, 7 Schritte)",
    [
      {
        heading: "Schritt 1 — Allgemeine Angaben (Betrieb)",
        rows: [
          ["Name des Betriebs", e?.companyName ?? ""],
          ["Betriebsnummer", e?.betriebsnummer ?? ""],
          ["Anschrift", [e?.street, e?.postalCode, e?.city].filter(Boolean).join(", ")],
        ],
      },
      {
        heading: "Schritt 2 — Weiterbildung (Upload: Nachweis Lehrgangskosten!)",
        rows: [
          ["Bezeichnung der Weiterbildung", m?.name ?? ""],
          ["Lehrgangskosten gesamt", m?.costEur ? `${m.costEur} EUR` : ""],
          ["Nachweis", "Kostenübersicht generieren und hochladen"],
        ],
      },
      {
        heading: "Schritt 3 — Zulassung (Upload: Träger- & Maßnahmezertifikat!)",
        rows: [
          ["Trägerzertifikat", "templates/documents/zertifikat-traeger_Z-000978.pdf"],
          ["Maßnahmezertifikat", "templates/documents/zertifikat-massnahme_Z-001270.pdf"],
          ["AZAV-Maßnahmennummer", m?.azavNumber ?? ""],
        ],
      },
      {
        heading: "Schritt 4 — Beschäftigtenliste (Upload: Teilnehmerliste!)",
        rows: [
          ["Teilnehmende in dieser Liste", String(cohortSize)],
          ["Formular", "Anlage zum Sammelantrag (BA I FW 501/502) — generieren"],
          ["Hinweis", "SV-Nummern werden noch nicht zentral erfasst"],
        ],
      },
      {
        heading: "Schritt 5–7 — Weitere Angaben, Prüfen & Zustimmung",
        rows: [
          ["Arbeitszeit-/Entgeltangaben je Person", "im Portal bzw. Liste Teil 2"],
          ["3 Bestätigungen", "im Portal ankreuzen"],
        ],
      },
    ],
  );
}

export async function generateEmployerDatasheet(
  data: ApplicationData,
): Promise<GeneratedFile> {
  const e = data.employer;
  return generateSummaryPdf("Arbeitgeber-Datenblatt", [
    {
      heading: "Unternehmen",
      rows: [
        ["Firma", e?.companyName ?? ""],
        ["Anschrift", [e?.street, e?.postalCode, e?.city].filter(Boolean).join(", ")],
        ["Branche", e?.industry ?? ""],
        ["Beschäftigte", e?.employeeCount?.toString() ?? ""],
        ["Betriebsnummer", e?.betriebsnummer ?? ""],
      ],
    },
    {
      heading: "Ansprechperson",
      rows: [
        ["Name", e?.contactName ?? ""],
        ["Funktion", e?.contactRole ?? ""],
        ["E-Mail", e?.contactEmail ?? ""],
        ["Telefon", e?.contactPhone ?? ""],
      ],
    },
    {
      heading: "Arbeitgeberservice",
      rows: [
        ["Zuständige Agentur", e?.responsibleAgency ?? ""],
        ["Registriert", e?.agsRegistered == null ? "unklar" : e.agsRegistered ? "ja" : "nein"],
        ["AG-S Kontakt", e?.agsContactName ?? ""],
        [
          "Zeitmodell 20 Std./Woche",
          e?.timeModelStatus === "yes" ? "bestätigt" : "nicht bestätigt",
        ],
      ],
    },
  ]);
}
