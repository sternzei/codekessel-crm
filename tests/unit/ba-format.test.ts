import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isValidBic,
  isValidIban,
  isValidSvNumber,
  parseDecimalString,
  parseFundingStatus,
  parseQualificationHistory,
  parseSalaryComponents,
  parseStaffingBands,
  parseWeeklyTimes,
  type FieldReader,
} from "@/lib/ba-format";

// Conservative BA-data validators + parsers (Epic A). The rule is: never
// reject a genuinely valid input, and never invent structured data from empty
// fields.

const reader = (map: Record<string, string>): FieldReader => (key) => map[key];

test("isValidIban accepts a well-formed IBAN, tolerant of spaces/case", () => {
  assert.equal(isValidIban("DE89370400440532013000"), true);
  assert.equal(isValidIban("de89 3704 0044 0532 0130 00"), true);
});

test("isValidIban rejects wrong checksum and malformed shapes", () => {
  assert.equal(isValidIban("DE89370400440532013001"), false);
  assert.equal(isValidIban("DE00"), false);
  assert.equal(isValidIban("XX"), false);
});

test("isValidBic accepts 8 and 11 char codes, rejects the rest", () => {
  assert.equal(isValidBic("PBNKDEFF"), true);
  assert.equal(isValidBic("PBNKDEFFXXX"), true);
  assert.equal(isValidBic("pbnkdeff"), true);
  assert.equal(isValidBic("PBNK"), false);
  assert.equal(isValidBic("1234DEFF"), false);
});

test("isValidSvNumber accepts the 12-char shape, tolerant of spaces", () => {
  assert.equal(isValidSvNumber("15070649C103"), true);
  assert.equal(isValidSvNumber("15 070649 C 103"), true);
  assert.equal(isValidSvNumber("1234"), false);
  assert.equal(isValidSvNumber("15070649CC03"), false);
});

test("parseDecimalString normalizes comma decimals, rejects junk/negatives", () => {
  assert.equal(parseDecimalString("2500,50"), "2500.5");
  assert.equal(parseDecimalString("1800"), "1800");
  assert.equal(parseDecimalString(""), null);
  assert.equal(parseDecimalString("abc"), null);
  assert.equal(parseDecimalString("-5"), null);
});

test("parseWeeklyTimes keeps only weekdays with BOTH from+to", () => {
  const times = parseWeeklyTimes(
    reader({
      schulung_mon_from: "09:00",
      schulung_mon_to: "16:30",
      schulung_tue_from: "09:00", // no 'to' → dropped
      schulung_wed_to: "12:00", // no 'from' → dropped
    }),
  );
  assert.deepEqual(times, { mon: { from: "09:00", to: "16:30" } });
  assert.equal(parseWeeklyTimes(reader({})), null);
});

test("parseQualificationHistory returns one entry only when a Beruf is set", () => {
  assert.equal(parseQualificationHistory(reader({})), null);
  assert.deepEqual(
    parseQualificationHistory(
      reader({ qualBeruf: "Fachinformatiker/in", qualAbschlussdatum: "2015-06-30" }),
    ),
    [
      {
        beruf: "Fachinformatiker/in",
        abschlussdatum: "2015-06-30",
        ausbildungVon: null,
        ausbildungBis: null,
      },
    ],
  );
});

test("parseFundingStatus only sets the flags that are present", () => {
  assert.equal(parseFundingStatus(reader({})), null);
  assert.deepEqual(
    parseFundingStatus(reader({ fundingKug: "on", fundingOther: "Reha" })),
    { kug: true, other: "Reha" },
  );
});

test("parseSalaryComponents keeps only complete label+amount pairs", () => {
  assert.equal(parseSalaryComponents(reader({})), null);
  assert.deepEqual(
    parseSalaryComponents(
      reader({ salaryLabel0: "Zulage", salaryAmount0: "150,00", salaryLabel1: "x" }),
    ),
    [{ label: "Zulage", amountEur: 150 }],
  );
});

test("parseStaffingBands parses non-negative integer counts by band", () => {
  assert.equal(parseStaffingBands(reader({})), null);
  assert.deepEqual(
    parseStaffingBands(
      reader({ staffing_unter_20h: "5", staffing_30_und_mehr: "-1" }),
    ),
    [{ band: "unter_20h", count: 5 }],
  );
});
