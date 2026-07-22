import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DOCUMENT_SIGNATURE_REQUIREMENTS,
  documentRequiresSignature,
  findMissingSignatures,
  getDocumentSignatureRequirement,
  isCanvasSignableSigner,
  requiredSignersFor,
} from "@/modules/signatures/requirements";
import {
  evaluateApplicationReadiness,
  type ApplicationData,
} from "@/modules/documents/data";

// Epic C: per-document-type signature classification (SES vs QES) and its
// effect on the shared submission-readiness gate.

test("the three real BA forms carry a signature requirement", () => {
  assert.equal(documentRequiresSignature("arbeitnehmererklaerung"), true);
  assert.equal(documentRequiresSignature("fragebogen"), true);
  assert.equal(documentRequiresSignature("vollmacht"), true);
});

test("forms without a digital signature are unclassified", () => {
  assert.equal(documentRequiresSignature("traegerbescheinigung"), false);
  assert.equal(documentRequiresSignature("cost_overview"), false);
  assert.equal(getDocumentSignatureRequirement("cost_overview"), null);
});

test("declarations are SES, the power of attorney is QES", () => {
  assert.deepEqual(DOCUMENT_SIGNATURE_REQUIREMENTS.arbeitnehmererklaerung, {
    signers: [{ kind: "participant", level: "SES" }],
  });
  assert.deepEqual(DOCUMENT_SIGNATURE_REQUIREMENTS.fragebogen, {
    signers: [{ kind: "participant", level: "SES" }],
  });
  assert.deepEqual(DOCUMENT_SIGNATURE_REQUIREMENTS.vollmacht, {
    signers: [{ kind: "participant", level: "QES" }],
  });
});

test("only SES signers are canvas-signable; QES is not", () => {
  assert.equal(isCanvasSignableSigner("arbeitnehmererklaerung", "participant"), true);
  assert.equal(isCanvasSignableSigner("fragebogen", "participant"), true);
  // QES (Vollmacht) must NOT be offered on the canvas path — no provider.
  assert.equal(isCanvasSignableSigner("vollmacht", "participant"), false);
  assert.equal(isCanvasSignableSigner("cost_overview", "participant"), false);
});

test("requiredSignersFor filters by eIDAS level", () => {
  assert.deepEqual(requiredSignersFor("vollmacht", "SES"), []);
  assert.deepEqual(requiredSignersFor("vollmacht", "QES"), [
    { kind: "participant", level: "QES" },
  ]);
});

test("findMissingSignatures flags unsigned required signers on present docs", () => {
  const documents = [
    { id: "d1", type: "arbeitnehmererklaerung" },
    { id: "d2", type: "cost_overview" },
  ];
  const missing = findMissingSignatures(documents, []);
  assert.equal(missing.length, 1);
  assert.deepEqual(missing[0], {
    documentId: "d1",
    documentType: "arbeitnehmererklaerung",
    signerKind: "participant",
    level: "SES",
  });
});

test("a signed required signer clears the gap", () => {
  const documents = [{ id: "d1", type: "arbeitnehmererklaerung" }];
  const signatures = [
    { documentId: "d1", signerKind: "participant", status: "signed" },
  ];
  assert.deepEqual(findMissingSignatures(documents, signatures), []);
});

test("a pending (not yet signed) signature is still missing", () => {
  const documents = [{ id: "d1", type: "fragebogen" }];
  const signatures = [
    { documentId: "d1", signerKind: "participant", status: "pending" },
  ];
  assert.equal(findMissingSignatures(documents, signatures).length, 1);
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
    documents: [{ type: "participant_form" }, { type: "cost_overview" }],
    signatures: [{ documentId: "generic", signerKind: "participant", status: "signed" }],
    consents: [{ kind: "privacy_policy", granted: true }],
    ...overrides,
  } as unknown as ApplicationData;
}

function hasBlocker(data: ApplicationData, code: string): boolean {
  return evaluateApplicationReadiness(data).blockers.some((b) => b.code === code);
}

test("an unsigned SES form blocks submission readiness", () => {
  const data = readyData({
    documents: [
      { id: "d1", type: "arbeitnehmererklaerung" },
      { type: "cost_overview" },
    ] as never,
  });
  assert.equal(hasBlocker(data, "form_signatures_ses"), true);
  assert.equal(evaluateApplicationReadiness(data).ready, false);
});

test("a signed SES form clears the blocker", () => {
  const data = readyData({
    documents: [{ id: "d1", type: "arbeitnehmererklaerung" }] as never,
    signatures: [
      { documentId: "d1", signerKind: "participant", status: "signed" },
    ] as never,
  });
  assert.equal(hasBlocker(data, "form_signatures_ses"), false);
});

test("an unsigned QES form only warns, never blocks (no provider)", () => {
  const data = readyData({
    documents: [{ id: "d1", type: "vollmacht" }] as never,
  });
  assert.equal(hasBlocker(data, "form_signatures_ses"), false);
  const result = evaluateApplicationReadiness(data);
  assert.equal(
    result.warnings.some((w) => w.code === "form_signatures_qes_pending"),
    true,
  );
});
