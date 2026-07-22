import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ESERVICE_UPLOAD_SETS,
  evaluateUploadSet,
  resolveApplicantType,
} from "@/modules/applications/upload-set";
import {
  evaluateApplicationReadiness,
  type ApplicationData,
} from "@/modules/documents/data";

// Epic C: path-aware eService upload set — which uploads each applicant_type
// needs, whether they are generated + signed, and the effect on readiness.

test("resolveApplicantType defaults unknown values to single", () => {
  assert.equal(resolveApplicantType("company"), "company");
  assert.equal(resolveApplicantType("single"), "single");
  assert.equal(resolveApplicantType(null), "single");
  assert.equal(resolveApplicantType("bogus"), "single");
});

test("the two paths declare distinct required uploads", () => {
  assert.deepEqual(
    ESERVICE_UPLOAD_SETS.single.filter((e) => e.required).map((e) => e.type),
    ["traegerbescheinigung", "arbeitnehmererklaerung"],
  );
  assert.deepEqual(
    ESERVICE_UPLOAD_SETS.company.filter((e) => e.required).map((e) => e.type),
    ["teilnehmerliste", "cost_overview"],
  );
});

test("an empty single application is missing both required uploads", () => {
  const { missingRequired } = evaluateUploadSet({
    applicantType: "single",
    documents: [],
    signatures: [],
  });
  assert.deepEqual(
    missingRequired.map((i) => i.type),
    ["traegerbescheinigung", "arbeitnehmererklaerung"],
  );
});

test("a generated-but-unsigned declaration stays incomplete", () => {
  const { missingRequired, items } = evaluateUploadSet({
    applicantType: "single",
    documents: [
      { id: "t1", type: "traegerbescheinigung", filePath: "var/a.pdf" },
      { id: "a1", type: "arbeitnehmererklaerung", filePath: "var/b.pdf" },
    ],
    signatures: [],
  });
  // Trägerbescheinigung needs no digital signature → complete once present.
  assert.equal(items.find((i) => i.type === "traegerbescheinigung")?.signed, true);
  // Arbeitnehmererklärung is present but unsigned → still required-missing.
  assert.deepEqual(
    missingRequired.map((i) => i.type),
    ["arbeitnehmererklaerung"],
  );
});

test("a fully present + signed single set has nothing missing", () => {
  const { missingRequired } = evaluateUploadSet({
    applicantType: "single",
    documents: [
      { id: "t1", type: "traegerbescheinigung", filePath: "var/a.pdf" },
      { id: "a1", type: "arbeitnehmererklaerung", filePath: "var/b.pdf" },
    ],
    signatures: [
      { documentId: "a1", signerKind: "participant", status: "signed" },
    ],
  });
  assert.equal(missingRequired.length, 0);
});

test("an optional QES form never blocks but is flagged qesPending", () => {
  const { missingRequired, items } = evaluateUploadSet({
    applicantType: "single",
    documents: [
      { id: "t1", type: "traegerbescheinigung", filePath: "var/a.pdf" },
      { id: "a1", type: "arbeitnehmererklaerung", filePath: "var/b.pdf" },
      { id: "v1", type: "vollmacht", filePath: "var/c.pdf" },
    ],
    signatures: [
      { documentId: "a1", signerKind: "participant", status: "signed" },
    ],
  });
  assert.equal(missingRequired.length, 0);
  const vollmacht = items.find((i) => i.type === "vollmacht");
  assert.equal(vollmacht?.required, false);
  assert.equal(vollmacht?.qesPending, true);
});

test("company path requires the Teilnehmerliste and cost overview", () => {
  const { missingRequired } = evaluateUploadSet({
    applicantType: "company",
    documents: [
      { id: "t1", type: "teilnehmerliste", filePath: "var/a.pdf" },
    ],
    signatures: [],
  });
  assert.deepEqual(
    missingRequired.map((i) => i.type),
    ["cost_overview"],
  );
});

// ---- Effect on evaluateApplicationReadiness -------------------------------

function readyData(overrides: Partial<ApplicationData> = {}): ApplicationData {
  return {
    participant: {
      firstName: "Lena",
      lastName: "Muster",
      dateOfBirth: "1990-01-01",
      phone: "0170",
      email: "lena@x.de",
      street: "Weg 1",
      postalCode: "10115",
      city: "Berlin",
      availabilityStatus: "yes",
    },
    employer: {
      companyName: "PflegePlus",
      contactName: "Chef",
      contactEmail: "chef@x.de",
      betriebsnummer: "12345678",
      agsRegistered: true,
      timeModelStatus: "yes",
    },
    measure: { azavNumber: "955/1", startDate: "2026-09-01", costEur: 5000 },
    documents: [],
    signatures: [{ documentId: "x", signerKind: "participant", status: "signed" }],
    consents: [{ kind: "privacy_policy", granted: true }],
    application: { applicantType: "single" },
    ...overrides,
  } as unknown as ApplicationData;
}

function hasBlocker(data: ApplicationData, code: string): boolean {
  return evaluateApplicationReadiness(data).blockers.some((b) => b.code === code);
}

test("a single application without its uploads blocks submission", () => {
  assert.equal(hasBlocker(readyData(), "upload_set_incomplete"), true);
  assert.equal(evaluateApplicationReadiness(readyData()).ready, false);
});

test("a single application with a signed upload set is ready", () => {
  const data = readyData({
    documents: [
      { id: "t1", type: "traegerbescheinigung", filePath: "var/a.pdf" },
      { id: "a1", type: "arbeitnehmererklaerung", filePath: "var/b.pdf" },
    ] as never,
    signatures: [
      { documentId: "a1", signerKind: "participant", status: "signed" },
    ] as never,
  });
  assert.equal(hasBlocker(data, "upload_set_incomplete"), false);
  assert.equal(hasBlocker(data, "form_signatures_ses"), false);
  assert.equal(evaluateApplicationReadiness(data).ready, true);
});

test("readiness without an application skips the upload-set gate", () => {
  const data = readyData({ application: null as never });
  assert.equal(hasBlocker(data, "upload_set_incomplete"), false);
});
