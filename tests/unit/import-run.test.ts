import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyBatchStats,
  emptyStats,
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
