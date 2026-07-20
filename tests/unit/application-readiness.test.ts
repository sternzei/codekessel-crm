import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateApplicationReadiness,
  type ApplicationData,
} from "@/modules/documents/data";

// Shared submission-readiness gate (concept §10/§14). The SAME evaluator backs
// the server transition to complete/submitted and the UI checklist.

function fullData(overrides: Partial<ApplicationData> = {}): ApplicationData {
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
    signatures: [{ status: "signed" }],
    consents: [{ kind: "privacy_policy", granted: true }],
    ...overrides,
  } as unknown as ApplicationData;
}

function hasBlocker(data: ApplicationData, code: string): boolean {
  return evaluateApplicationReadiness(data).blockers.some((b) => b.code === code);
}

test("a complete package is ready with no blockers", () => {
  const result = evaluateApplicationReadiness(fullData());
  assert.equal(result.ready, true);
  assert.equal(result.blockers.length, 0);
});

test("missing required signatures block completion", () => {
  assert.equal(hasBlocker(fullData({ signatures: [] as never }), "signatures_incomplete"), true);
  // A pending (not-yet-signed) signature must also block.
  assert.equal(
    hasBlocker(fullData({ signatures: [{ status: "pending" }] as never }), "signatures_incomplete"),
    true,
  );
  assert.equal(evaluateApplicationReadiness(fullData({ signatures: [] as never })).ready, false);
});

test("missing privacy consent blocks completion", () => {
  assert.equal(hasBlocker(fullData({ consents: [] as never }), "consent_privacy"), true);
});

test("incomplete participant data blocks completion", () => {
  const data = fullData({
    participant: { ...fullData().participant, dateOfBirth: null } as never,
  });
  assert.equal(hasBlocker(data, "participant_data"), true);
});

test("missing employer BA prerequisites block completion", () => {
  const data = fullData({ employer: null as never });
  assert.equal(hasBlocker(data, "betriebsnummer_missing"), true);
  assert.equal(hasBlocker(data, "ags_unconfirmed"), true);
});

test("a missing measure blocks completion", () => {
  assert.equal(hasBlocker(fullData({ measure: null as never }), "no_measure"), true);
});

test("warnings do not block completion", () => {
  // Time model, participant availability and document count are warnings only.
  const data = fullData({
    employer: { ...fullData().employer, timeModelStatus: "unclear" } as never,
    participant: { ...fullData().participant, availabilityStatus: "unclear" } as never,
    documents: [] as never,
  });
  const result = evaluateApplicationReadiness(data);
  assert.equal(result.ready, true);
  assert.ok(result.warnings.length >= 3);
});

test("an incomplete-but-present measure warns but does not block", () => {
  const data = fullData({ measure: { azavNumber: "955/1" } as never });
  assert.equal(hasBlocker(data, "no_measure"), false);
  const measureCheck = evaluateApplicationReadiness(data).checks.find(
    (c) => c.code === "no_measure",
  );
  assert.equal(measureCheck?.state, "warn");
});
