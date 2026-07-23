import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildFinancialColumns,
  emptyBatchStats,
  emptyStats,
  parseFinancialYear,
  tallyBatch,
  tallyOutcome,
  type BatchItemResult,
  type ImportOutcome,
} from "@/modules/register/import-run";

// The import_runs stats must reflect the REAL per-company outcome — never a
// blanket "everything = inserted". These pin the honesty guarantee that the
// DB producer depends on (separate pure calc from the DB write).

test("empty stats start at zero on every counter", () => {
  assert.deepEqual(emptyStats(), {
    inserted: 0,
    updated: 0,
    skipped: 0,
    conflicted: 0,
  });
});

test("each outcome increments exactly its own counter, nothing else", () => {
  const outcomes: ImportOutcome[] = [
    "inserted",
    "updated",
    "skipped",
    "conflicted",
  ];
  for (const outcome of outcomes) {
    const stats = tallyOutcome(outcome);
    assert.equal(stats[outcome], 1, `${outcome} counter set to 1`);
    const others = outcomes.filter((o) => o !== outcome);
    for (const other of others) {
      assert.equal(stats[other], 0, `${other} stays 0 for a ${outcome} import`);
    }
  }
});

test("a skipped import is NOT recorded as inserted", () => {
  const stats = tallyOutcome("skipped");
  assert.equal(stats.inserted, 0);
  assert.equal(stats.skipped, 1);
});

// --- Batch stats: one honest run row for a multi-company import -------------

test("empty batch stats start at zero on every counter", () => {
  assert.deepEqual(emptyBatchStats(), {
    discovered: 0,
    inserted: 0,
    updated: 0,
    skipped: 0,
    conflicted: 0,
    failed: 0,
  });
});

test("tallyBatch counts each real outcome and never inflates inserted", () => {
  const results: BatchItemResult[] = [
    "inserted",
    "inserted",
    "updated",
    "skipped",
    "conflicted",
    "failed",
  ];
  const stats = tallyBatch(results);
  assert.deepEqual(stats, {
    discovered: 6,
    inserted: 2,
    updated: 1,
    skipped: 1,
    conflicted: 1,
    failed: 1,
  });
  // discovered accounts for every attempted company (including failures).
  assert.equal(
    stats.inserted + stats.updated + stats.skipped + stats.conflicted + stats.failed,
    stats.discovered,
  );
});

test("tallyBatch of an empty batch discovers nothing", () => {
  assert.deepEqual(tallyBatch([]), emptyBatchStats());
});

// --- Structured financial provenance: discovery signal → persisted columns --
// These pin the parse→persist mapping the imported lead depends on: a missing
// figure stays null (NEVER coerced to 0) and the sign of a loss is preserved.

test("parseFinancialYear reads the 4-digit year from a plain year or a date", () => {
  assert.equal(parseFinancialYear("2024"), 2024);
  assert.equal(parseFinancialYear("2024-12-31"), 2024);
});

test("parseFinancialYear returns null for absent or non-numeric input", () => {
  assert.equal(parseFinancialYear(null), null);
  assert.equal(parseFinancialYear(""), null);
  assert.equal(parseFinancialYear("n/a"), null);
});

test("buildFinancialColumns maps a loss to a sign-safe numeric string", () => {
  const columns = buildFinancialColumns({
    profitEur: -84_000,
    fiscalYear: "2024",
    financialsSource: "search_row",
  });
  assert.deepEqual(columns, {
    netIncome: "-84000",
    financialYear: 2024,
    financialsSource: "search_row",
  });
});

test("buildFinancialColumns keeps a missing net income null — never coerced to 0", () => {
  const columns = buildFinancialColumns({
    profitEur: null,
    fiscalYear: "2023-12-31",
    financialsSource: "indicators",
  });
  assert.equal(columns.netIncome, null);
  assert.notEqual(columns.netIncome, "0");
  assert.equal(columns.financialYear, 2023);
  assert.equal(columns.financialsSource, "indicators");
});

test("buildFinancialColumns preserves a genuine break-even 0 (not null)", () => {
  const columns = buildFinancialColumns({
    profitEur: 0,
    fiscalYear: null,
    financialsSource: "indicators",
  });
  assert.equal(columns.netIncome, "0");
  assert.equal(columns.financialYear, null);
});

test("buildFinancialColumns with no signal at all persists all-null provenance", () => {
  const columns = buildFinancialColumns({
    profitEur: null,
    fiscalYear: null,
    financialsSource: null,
  });
  assert.deepEqual(columns, {
    netIncome: null,
    financialYear: null,
    financialsSource: null,
  });
});

test("tally accumulates onto a provided base without mutating it", () => {
  const base = emptyStats();
  const afterInsert = tallyOutcome("inserted", base);
  const afterUpdate = tallyOutcome("updated", afterInsert);
  assert.deepEqual(afterUpdate, {
    inserted: 1,
    updated: 1,
    skipped: 0,
    conflicted: 0,
  });
  // Inputs are left untouched (pure, no aliasing).
  assert.deepEqual(base, emptyStats());
  assert.deepEqual(afterInsert, {
    inserted: 1,
    updated: 0,
    skipped: 0,
    conflicted: 0,
  });
});
