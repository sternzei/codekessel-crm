import { test } from "node:test";
import assert from "node:assert/strict";
import type { ApplicationData } from "@/modules/documents/data";
import {
  DOCUMENT_REQUIREMENTS,
  findMissingDocumentData,
  isDocumentType,
} from "@/modules/documents/prerequisites";

// ApplicationData is inferred from a database query, so a fixture only carries
// the fields the prerequisite checks actually read.
type Fixture = {
  participant: { dateOfBirth: string | null; street: string | null };
  employer: object | null;
  measure: { startDate: string | null; costEur: string | null } | null;
};

const buildData = (overrides: Partial<Fixture> = {}): ApplicationData => {
  const fixture: Fixture = {
    participant: { dateOfBirth: "1990-04-01", street: "Lindenstraße 14" },
    employer: { companyName: "Nordlicht Logistik GmbH" },
    measure: { startDate: "2026-09-01", costEur: "7480.00" },
    ...overrides,
  };
  return fixture as unknown as ApplicationData;
};

test("a complete record generates every document", () => {
  const inputData = buildData();
  for (const type of Object.keys(DOCUMENT_REQUIREMENTS)) {
    assert.ok(isDocumentType(type));
    assert.deepEqual(
      findMissingDocumentData(type, inputData),
      [],
      `${type} should have no missing prerequisites`,
    );
  }
});

test("a participant without an employer names the employer, not silence", () => {
  const inputData = buildData({ employer: null });
  assert.deepEqual(findMissingDocumentData("vollmacht", inputData), [
    "Arbeitgeber",
  ]);
  assert.deepEqual(findMissingDocumentData("eservice_single", inputData), [
    "Arbeitgeber",
  ]);
  // The live test's failing set: these are exactly the ones that need a Betrieb.
  assert.deepEqual(findMissingDocumentData("teilnehmerliste", inputData), [
    "Arbeitgeber",
  ]);
  assert.deepEqual(findMissingDocumentData("employer_datasheet", inputData), [
    "Arbeitgeber",
  ]);
  // ...while a measure-only document is unaffected.
  assert.deepEqual(findMissingDocumentData("fragebogen", inputData), []);
});

test("every missing field is listed, not just the first", () => {
  const inputData = buildData({
    participant: { dateOfBirth: null, street: null },
  });
  assert.deepEqual(findMissingDocumentData("participant_form", inputData), [
    "Geburtsdatum",
    "Straße",
  ]);
});

test("a measure without a start date blocks only the forms that print it", () => {
  const inputData = buildData({
    measure: { startDate: null, costEur: "7480.00" },
  });
  assert.deepEqual(findMissingDocumentData("traegerbescheinigung", inputData), [
    "Maßnahmebeginn",
  ]);
  assert.deepEqual(findMissingDocumentData("cost_overview", inputData), []);
});

test("an unlinked measure is reported as the measure itself", () => {
  const inputData = buildData({ measure: null });
  assert.deepEqual(findMissingDocumentData("fragebogen", inputData), [
    "Maßnahme",
  ]);
  assert.deepEqual(findMissingDocumentData("cost_overview", inputData), [
    "Lehrgangskosten",
  ]);
});

test("an unknown document type is rejected", () => {
  assert.equal(isDocumentType("schlusserklaerung"), false);
});
