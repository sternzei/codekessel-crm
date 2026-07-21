import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildArbeitnehmererklaerungValues,
  buildTeilnehmerlisteValues,
  buildTraegerbescheinigungValues,
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
