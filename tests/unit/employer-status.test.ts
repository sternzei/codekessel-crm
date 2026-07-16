import { test } from "node:test";
import assert from "node:assert/strict";
import type { employers } from "@/db/schema";
import { deriveEmployerStatus } from "@/modules/employers/service";

type EmployerRow = typeof employers.$inferSelect;

// Employer status is derived from the next bottleneck in the setup chain:
// Betriebsnummer → AG-S → time model → contact → confirmed.
function employer(overrides: Partial<EmployerRow>): EmployerRow {
  return {
    betriebsnummer: "12345678",
    agsRegistered: true,
    agsContactName: "Frau Muster",
    timeModelStatus: "yes",
    contactName: "Herr Chef",
    contactEmail: "chef@firma.de",
    ...overrides,
  } as unknown as EmployerRow;
}

test("missing Betriebsnummer is the first bottleneck", () => {
  assert.equal(
    deriveEmployerStatus(employer({ betriebsnummer: null })),
    "betriebsnummer_missing",
  );
});

test("unknown AG-S registration is unclear", () => {
  assert.equal(
    deriveEmployerStatus(employer({ agsRegistered: null })),
    "ags_unclear",
  );
});

test("registered AG-S without a named contact is still unclear", () => {
  assert.equal(
    deriveEmployerStatus(employer({ agsRegistered: true, agsContactName: null })),
    "ags_unclear",
  );
});

test("time model not yet confirmed blocks at time_model_pending", () => {
  assert.equal(
    deriveEmployerStatus(employer({ timeModelStatus: "partial" })),
    "time_model_pending",
  );
});

test("missing company contact keeps setup in progress", () => {
  assert.equal(
    deriveEmployerStatus(employer({ contactEmail: null })),
    "setup_in_progress",
  );
});

test("all data present resolves to confirmed", () => {
  assert.equal(deriveEmployerStatus(employer({})), "confirmed");
});
