import { test } from "node:test";
import assert from "node:assert/strict";
import type { DbHandle } from "@/db/client";
import {
  applications,
  consentRecords,
  documents,
  employers,
  participants,
} from "@/db/schema";
import { collectApplicationData } from "@/modules/documents/data";

// collectApplicationData assembles the central data pool. This pins that the
// Epic A columns (SV number, bank details, salary, hours, qualification,
// funding, employer legal form / staffing) flow through the DTO — driven by a
// table-keyed query stub, no database.

type Rows = Map<unknown, Record<string, unknown>[]>;

function makeTx(byTable: Rows): DbHandle {
  const from = (table: unknown) => {
    const rows = byTable.get(table) ?? [];
    const whereResult = {
      orderBy: () => Promise.resolve(rows),
      then: (
        resolve: (value: unknown) => unknown,
        reject: (reason: unknown) => unknown,
      ) => Promise.resolve(rows).then(resolve, reject),
    };
    return { where: () => whereResult };
  };
  return { select: () => ({ from }) } as unknown as DbHandle;
}

test("collectApplicationData returns the Epic A participant + employer fields", async () => {
  const participantRow = {
    id: "p-1",
    firstName: "Lena",
    lastName: "Hoffmann",
    employerId: "e-1",
    measureId: null,
    assignedConsultantId: null,
    svNumber: "15070649C103",
    iban: "DE89370400440532013000",
    bic: "PBNKDEFF",
    monthlyGrossSalary: "2500.00",
    salaryComponents: [{ label: "Zulage", amountEur: 150 }],
    weeklyWorkingHours: "20.00",
    monthlyWorkingHours: "86.00",
    schulungszeiten: { mon: { from: "09:00", to: "16:30" } },
    freistellungsstunden: "120.00",
    qualificationHistory: [{ beruf: "Kauffrau", abschlussdatum: "2015-06-30" }],
    fundingStatus: { kug: true },
  };
  const employerRow = {
    id: "e-1",
    companyName: "Muster GmbH",
    legalForm: "GmbH",
    iban: "DE89370400440532013000",
    bic: "PBNKDEFF",
    staffingByHoursBand: [{ band: "unter_20h", count: 5 }],
    salaryComponents: [{ label: "Bonus", amountEur: 500 }],
    hasBetriebsvereinbarung: true,
  };
  const byTable: Rows = new Map();
  byTable.set(participants, [participantRow]);
  byTable.set(employers, [employerRow]);
  byTable.set(documents, []);
  byTable.set(consentRecords, []);
  byTable.set(applications, []);

  const data = await collectApplicationData(makeTx(byTable), "p-1");

  assert.ok(data);
  assert.equal(data.participant.svNumber, "15070649C103");
  assert.equal(data.participant.iban, "DE89370400440532013000");
  assert.equal(data.participant.monthlyGrossSalary, "2500.00");
  assert.deepEqual(data.participant.schulungszeiten, {
    mon: { from: "09:00", to: "16:30" },
  });
  assert.deepEqual(data.participant.qualificationHistory, [
    { beruf: "Kauffrau", abschlussdatum: "2015-06-30" },
  ]);
  assert.deepEqual(data.participant.fundingStatus, { kug: true });
  assert.equal(data.employer?.legalForm, "GmbH");
  assert.deepEqual(data.employer?.staffingByHoursBand, [
    { band: "unter_20h", count: 5 },
  ]);
  assert.equal(data.employer?.hasBetriebsvereinbarung, true);
});
