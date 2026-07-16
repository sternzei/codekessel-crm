import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildChecklist,
  type ApplicationData,
  type ChecklistItem,
} from "@/modules/documents/data";

// buildChecklist maps the central data model onto the pre-submission
// readiness view (concept §10): ok / warn / missing per requirement.

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

function stateOf(items: ChecklistItem[], label: string): string {
  const item = items.find((i) => i.label.startsWith(label));
  assert.ok(item, `checklist item "${label}" exists`);
  return item.state;
}

test("complete data set is all green", () => {
  const items = buildChecklist(fullData());
  assert.ok(items.every((i) => i.state === "ok"), JSON.stringify(items));
});

test("missing consent is flagged missing", () => {
  const items = buildChecklist(fullData({ consents: [] as never }));
  assert.equal(stateOf(items, "Einwilligungen"), "missing");
});

test("no employer marks employer + Betriebsnummer as missing", () => {
  const items = buildChecklist(fullData({ employer: null as never }));
  assert.equal(stateOf(items, "Arbeitgeberdaten"), "missing");
  assert.equal(stateOf(items, "Betriebsnummer"), "missing");
});

test("unsigned pending signature is a warning, not ok", () => {
  const items = buildChecklist(
    fullData({ signatures: [{ status: "pending" }] as never }),
  );
  assert.equal(stateOf(items, "Erforderliche Signaturen"), "warn");
});

test("participant availability not yet 'yes' is missing", () => {
  const items = buildChecklist(
    fullData({
      participant: { ...fullData().participant, availabilityStatus: "unclear" } as never,
    }),
  );
  assert.equal(stateOf(items, "Verfügbarkeit bestätigt"), "missing");
});
