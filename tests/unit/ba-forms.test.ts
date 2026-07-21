import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildArbeitnehmererklaerungValues,
  buildFragebogenValues,
  buildTeilnehmerlisteValues,
  buildTraegerbescheinigungValues,
  buildVollmachtValues,
  TEILNEHMERLISTE_MAX_ROWS,
} from "@/modules/documents/ba-forms";
import type { ApplicationData } from "@/modules/documents/data";

// Mappings for the real BA forms. Field names were verified against the
// original AcroForms (ba042369; BA I FW 501/502) and, for the
// Trägerbescheinigung, against a real filled example.

function data(overrides: {
  measure?: Partial<NonNullable<ApplicationData["measure"]>> | null;
}): ApplicationData {
  return {
    participant: {
      firstName: "Marc Richard",
      lastName: "Fincham",
      dateOfBirth: "1961-09-30",
    },
    employer: null,
    measure:
      overrides.measure === null
        ? null
        : {
            name: "Citizen AI Automation Engineer",
            azavNumber: "677/0083/2026",
            durationWeeks: 26,
            weeklyHours: 20,
            startDate: "2026-09-14",
            ...overrides.measure,
          },
    documents: [],
    signatures: [],
    consents: [],
    application: null,
  } as unknown as ApplicationData;
}

test("Trägerbescheinigung: maps participant + measure onto ba042369 fields", () => {
  const values = buildTraegerbescheinigungValues(
    data({}),
    { city: "Böblingen" },
    new Date("2026-07-07T12:00:00Z"),
  );

  assert.equal(values.txtf_1_Vorname, "Marc Richard");
  assert.equal(values.txtf_2_Nachname, "Fincham");
  assert.equal(values.txtf_3_Geburtsdatum, "30.09.1961");
  assert.equal(values.txtf_4_Massnahme, "Citizen AI Automation Engineer");
  assert.equal(values.txtf_7_Beginn_Massnahme, "14.09.2026");
  // 26 weeks × 20 h = 520 Unterrichtsstunden.
  assert.equal(values.txtf_9_Anzahl_Unterrichtsstunden, "520");
  // Radio groups: aufgenommen = ja (0), zugelassen = ja (0), kein
  // Berufsabschluss (1), Maßnahmenummer vorhanden (0).
  assert.deepEqual(values.rbtn_5_Person_in_Massnahme_aufgenommen, { option: "0" });
  assert.deepEqual(values.rbtn_6_zugelassene_Massnahme, { option: "0" });
  assert.deepEqual(values.rbtn_11_Weiterbildung_Berufsabschluss, { option: "1" });
  assert.deepEqual(values.rbtn_12_Massnahmenummer_vorhanden, { option: "0" });
  assert.equal(values.txtf_13_Massnahmenummer, "677/0083/2026");
  assert.equal(values.txtf_14_Ort, "Böblingen");
  assert.equal(values.txtf_15_Datum, "07.07.2026");
});

test("Trägerbescheinigung: missing Maßnahmenummer selects 'nein'", () => {
  const values = buildTraegerbescheinigungValues(
    data({ measure: { azavNumber: null } }),
    { city: "Böblingen" },
  );
  assert.deepEqual(values.rbtn_12_Massnahmenummer_vorhanden, { option: "1" });
  assert.equal(values.txtf_13_Massnahmenummer, undefined);
});

test("Teilnehmerliste: employer header + one row per cohort member", () => {
  const values = buildTeilnehmerlisteValues(
    {
      betriebsnummer: "72376501",
      street: "Lauchstraße 1",
      postalCode: "71032",
      city: "Böblingen",
    },
    "Citizen AI Automation Engineer",
    [
      { firstName: "Lena", lastName: "Hoffmann", dateOfBirth: "1990-01-01" },
      { firstName: "Tarek", lastName: "Aziz", dateOfBirth: null },
    ],
    new Date("2026-07-14T12:00:00Z"),
  );

  assert.equal(values.txtfBetriebNr, "72376501");
  assert.equal(values.txtfBetriebStr, "Lauchstraße");
  assert.equal(values.txtfBetriebHausNr, "1");
  assert.equal(values.txtfBetriebPlz, "71032");
  assert.equal(values.txtfBetriebOrt, "Böblingen");
  assert.equal(values.txtfWeiterbildungsmassnahme, "Citizen AI Automation Engineer");

  assert.equal(values.txtfTabTeilnehmerPerson1Vorname, "Lena");
  assert.equal(values.txtfTabTeilnehmerPerson1Nachname, "Hoffmann");
  assert.equal(values.dateTabTeilnehmerPerson1GebDatum, "01.01.1990");
  // SV number is not yet captured centrally → blank, never undefined.
  assert.equal(values.txtfTabTeilnehmerPerson1SVNummer, "");
  assert.equal(values.txtfTabTeilnehmerPerson2Vorname, "Tarek");
  assert.equal(values.dateTabTeilnehmerPerson2GebDatum, "");
  // No third row.
  assert.equal(values.txtfTabTeilnehmerPerson3Vorname, undefined);
});

// --- Arbeitnehmererklärung (ba042354) --------------------------------------

function arbeitnehmerData(overrides: {
  hasQualification?: boolean;
  employer?: boolean;
}): ApplicationData {
  return {
    participant: {
      firstName: "Lena",
      lastName: "Hoffmann",
      dateOfBirth: "1990-01-01",
      city: "Böblingen",
      qualificationHistory: overrides.hasQualification
        ? [{ beruf: "Kauffrau", abschlussdatum: "2015-06-30" }]
        : null,
    },
    employer:
      overrides.employer === false
        ? null
        : {
            companyName: "Muster GmbH",
            street: "Lauchstraße 1",
            postalCode: "71032",
            city: "Böblingen",
          },
    measure: null,
    documents: [],
    signatures: [],
    consents: [],
    application: null,
  } as unknown as ApplicationData;
}

test("Arbeitnehmererklärung: maps person + Betrieb + qualification", () => {
  const values = buildArbeitnehmererklaerungValues(
    arbeitnehmerData({ hasQualification: true }),
    new Date("2026-07-21T12:00:00Z"),
  );
  assert.equal(values.txtf_Vorname, "Lena");
  assert.equal(values.txtf_Nachname, "Hoffmann");
  assert.equal(values.txtf_Geburtsdatum, "01.01.1990");
  assert.equal(values.txtf_Betriebsbezeichnung, "Muster GmbH");
  assert.equal(values.txtf_Strasse, "Lauchstraße");
  assert.equal(values.txtf_Hausnummer, "1");
  assert.equal(values.txtf_PLZ, "71032");
  assert.equal(values.txtf_Ort, "Böblingen");
  assert.equal(values.txtf_OrtU, "Böblingen");
  assert.equal(values.txtf_Datum, "21.07.2026");
  assert.deepEqual(values.rbtn_Berufsabschluss_vorhanden, { option: "ja" });
  assert.equal(values.txtf_Berufsabschluss_Berufsbezeichnung, "Kauffrau");
  assert.equal(values.txtf_Zeugnisdatum, "30.06.2015");
});

test("Arbeitnehmererklärung: no qualification → 'nein', fields left blank", () => {
  const values = buildArbeitnehmererklaerungValues(
    arbeitnehmerData({ hasQualification: false }),
  );
  assert.deepEqual(values.rbtn_Berufsabschluss_vorhanden, {
    option: "nein (weiter mit 13)",
  });
  assert.equal(values.txtf_Berufsabschluss_Berufsbezeichnung, undefined);
  assert.equal(values.txtf_Zeugnisdatum, undefined);
});

// --- Vollmacht (ba051211) --------------------------------------------------

function vollmachtData(): ApplicationData {
  return {
    participant: {
      firstName: "Lena",
      lastName: "Hoffmann",
      dateOfBirth: "1990-01-01",
      street: "Ahornweg 12a",
      postalCode: "71034",
      city: "Böblingen",
      employmentStatus: "employed",
      svNumber: "15070649C103",
      qualificationHistory: [
        { beruf: "Kauffrau", abschlussdatum: "2015-06-30" },
      ],
      fundingStatus: { kug: true },
    },
    employer: {
      companyName: "Muster GmbH",
      legalForm: "GmbH",
      street: "Lauchstraße 1",
      postalCode: "71032",
      city: "Böblingen",
      contactName: "Anna Müller",
      contactEmail: "anna@muster.de",
      contactPhone: "07031 1234",
      employeeCount: 42,
    },
    measure: {
      name: "Citizen AI Automation Engineer",
      durationWeeks: 26,
      weeklyHours: 20,
      startDate: "2026-09-14",
    },
    documents: [],
    signatures: [],
    consents: [],
    application: null,
  } as unknown as ApplicationData;
}

test("Vollmacht: maps person, employer/Betrieb and Epic A data", () => {
  const values = buildVollmachtValues(
    vollmachtData(),
    new Date("2026-07-21T12:00:00Z"),
  );
  assert.equal(values.txtfAnlSVNr, "15070649C103");
  assert.equal(values.txtfAnlBetriebVorname, "Anna");
  assert.equal(values.txtfAnlBetriebNachname, "Müller");
  assert.equal(values.numfAnlBetriebSVPflichtig, "42");
  assert.equal(values.txtfVMPersonVorname, "Lena");
  assert.equal(values.dateVMPersonGebDatum, "01.01.1990");
  assert.equal(values.txtfVMPersonStr, "Ahornweg");
  assert.equal(values.txtfVMPersonHausNr, "12a");
  assert.equal(values.txtfVMBetriebName, "Muster GmbH");
  assert.equal(values.txtfVMBetriebRechtsform, "GmbH");
  assert.equal(values.txtfVMBetriebStr, "Lauchstraße");
  assert.equal(values.txtfVMBetriebHausNr, "1");
  assert.equal(values.dateAnlUnterschrift, "21.07.2026");
  assert.deepEqual(values.rbtnVMPersonVollmacht, {
    option: "die Vollmacht ist unbefristet",
  });
  assert.deepEqual(values.rbtnAnlPersonArbeitsverh, { option: "ja" });
  assert.deepEqual(values.rbtnAnlPersonWeiterbildung, { option: "ja " });
  assert.deepEqual(values.rbtnAnlPersonBerufsabschluss, { option: "ja" });
  assert.equal(values.txtfAnlPersonBerufsbild, "Kauffrau");
  assert.deepEqual(values.rbtnAnlBetriebKug, { option: "ja" });
});

test("Vollmacht: unknown answers stay blank (no invented radios)", () => {
  const base = vollmachtData();
  const values = buildVollmachtValues({
    ...base,
    participant: {
      ...base.participant,
      employmentStatus: null,
      qualificationHistory: null,
      fundingStatus: null,
    },
    measure: null,
  } as unknown as ApplicationData);
  assert.equal(values.rbtnAnlPersonArbeitsverh, undefined);
  assert.equal(values.rbtnAnlPersonWeiterbildung, undefined);
  assert.equal(values.rbtnAnlPersonBerufsabschluss, undefined);
  assert.equal(values.rbtnAnlBetriebKug, undefined);
  assert.equal(values.rbtnAnlBetriebZuschuss, undefined);
});

// --- Teilnehmer-Fragebogen (ba046157) --------------------------------------

test("Fragebogen: maps person, bank, measure and Berufsabschluss (FB block)", () => {
  const data = {
    ...vollmachtData(),
    participant: {
      ...vollmachtData().participant,
      email: "lena@example.de",
      phone: "07031 999",
      iban: "DE89370400440532013000",
      bic: "COBADEFFXXX",
      qualificationHistory: [
        {
          beruf: "Kauffrau",
          abschlussdatum: "2015-06-30",
          ausbildungVon: "2012-09-01",
          ausbildungBis: "2015-06-30",
        },
      ],
    },
    measure: {
      name: "Citizen AI Automation Engineer",
      objective: "Prozessautomatisierung",
      azavNumber: "955/1234/25",
      durationWeeks: 26,
      weeklyHours: 20,
      startDate: "2026-09-14",
    },
  } as unknown as ApplicationData;
  const values = buildFragebogenValues(
    data,
    { name: "codeKessel Inh. Ugur Karatas" },
    new Date("2026-07-21T12:00:00Z"),
  );
  assert.equal(values.txtf_1_FB_Vorname, "Lena");
  assert.equal(values.txtf_5_FB_Sozialversicherungsnummer, "15070649C103");
  assert.equal(values.txtf_6_FB_Strasse, "Ahornweg");
  assert.equal(values.txtf_7_FB_Hausummer, "12a");
  assert.equal(values.txtf_13_FB_IBAN, "DE89370400440532013000");
  assert.equal(values.txtf_14_FB_BIC, "COBADEFFXXX");
  assert.equal(values.txtf_17_FB_Massnahmenummer, "955/1234/25");
  assert.equal(
    values.txtf_27_FB_Ziel_der_Weiterbildungsmassnahme,
    "Prozessautomatisierung",
  );
  assert.equal(
    values.txtf_28_FB_Name_Massnahmetraeger,
    "codeKessel Inh. Ugur Karatas",
  );
  assert.equal(values.txtf_34_FB_Beginn_Teilnahme, "14.09.2026");
  assert.equal(values.txtf_35_FB_Ende_Teilnahme, "15.03.2027");
  assert.equal(values.txtf_45_FB_Datum_Erklaerung_Unterschrift, "21.07.2026");
  assert.deepEqual(values.rbtn_18_FB_SozVersPfl_Arbeitsverhaeltnis, {
    option: "ja",
  });
  assert.deepEqual(values.rbtn_19_FB_Anspruch_TKug, { option: "ja" });
  assert.deepEqual(values.rbtn_22_FB_Berufsabschluss_Ausbildungsberuf, {
    option: "ja",
  });
  assert.equal(values.txtf_24_FB_Ausbildungszeit_Datum_von, "01.09.2012");
  // Identity is repeated on the AFB annex page.
  assert.equal(values.txtf_1_AFB_Vorname, "Lena");
  assert.equal(values.txtf_3_AFB_Geburtsdatum, "01.01.1990");
});

test("Fragebogen: leaves the travel/childcare annex and unknowns blank", () => {
  const base = vollmachtData();
  const values = buildFragebogenValues(
    {
      ...base,
      participant: {
        ...base.participant,
        employmentStatus: null,
        qualificationHistory: null,
        fundingStatus: null,
      },
      measure: null,
    } as unknown as ApplicationData,
    { name: "codeKessel Inh. Ugur Karatas" },
  );
  // Radios only affirmed with data.
  assert.equal(values.rbtn_18_FB_SozVersPfl_Arbeitsverhaeltnis, undefined);
  assert.equal(values.rbtn_22_FB_Berufsabschluss_Ausbildungsberuf, undefined);
  assert.equal(values.rbtn_19_FB_Anspruch_TKug, undefined);
  // AFB travel-cost / childcare fields are never mapped.
  assert.equal(values.txtf_25_AFB_Ticketkosten_Euro, undefined);
  assert.equal(values.txtf_AFB_Erstes_Kind_Name, undefined);
  // Fields we never capture stay blank.
  assert.equal(values.txtf_4_FB_Kundennummer, undefined);
  assert.equal(values.txtf_10_FB_Staatsangehoerigkeit, undefined);
});

test("Teilnehmerliste: caps at the form's 18 rows", () => {
  const cohort = Array.from({ length: 25 }, (_, i) => ({
    firstName: `P${i + 1}`,
    lastName: "Test",
    dateOfBirth: null,
  }));
  const values = buildTeilnehmerlisteValues(
    { betriebsnummer: null, street: null, postalCode: null, city: null },
    "M",
    cohort,
  );
  assert.equal(
    values[`txtfTabTeilnehmerPerson${TEILNEHMERLISTE_MAX_ROWS}Vorname`],
    "P18",
  );
  assert.equal(values.txtfTabTeilnehmerPerson19Vorname, undefined);
});
