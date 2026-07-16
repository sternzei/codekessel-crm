import { test } from "node:test";
import assert from "node:assert/strict";
import {
  arePhonesEquivalent,
  normalizePhone,
} from "@/modules/participants/phone";

// The same German number written three common ways must collapse to one
// comparable value so import dedup and messaging use the same key.

test("the +49, 0-trunk, and 0049 forms all normalize to the same value", () => {
  const expected = "497131123456";
  assert.equal(normalizePhone({ raw: "+49 7131 123456" }).normalized, expected);
  assert.equal(normalizePhone({ raw: "07131 123456" }).normalized, expected);
  assert.equal(
    normalizePhone({ raw: "0049 7131 123456" }).normalized,
    expected,
  );
  assert.ok(arePhonesEquivalent("+49 7131 123456", "07131 123456"));
  assert.ok(arePhonesEquivalent("07131 123456", "0049 7131 123456"));
});

test("preserves the original formatted value", () => {
  const result = normalizePhone({ raw: "  +49 (7131) 123-456 " });
  assert.equal(result.original, "+49 (7131) 123-456");
  assert.equal(result.normalized, "497131123456");
});

test("keeps a number that is already prefix-less and trunk-less as-is", () => {
  // No "+", no "00", no leading "0" — we must not guess/prepend a country code.
  assert.equal(normalizePhone({ raw: "491511234567" }).normalized, "491511234567");
});

test("does not blindly strip leading zeros (only the single trunk 0)", () => {
  // Only the one national trunk "0" is replaced by the country code; internal
  // zeros in the significant number must survive untouched.
  assert.equal(
    normalizePhone({ raw: "0201 3040506" }).normalized,
    "492013040506",
  );
});

test("handles numbers with an extension by retaining its digits", () => {
  const result = normalizePhone({ raw: "07131 123456-20" });
  assert.equal(result.normalized, "49713112345620");
});

test("short switchboard numbers still normalize but never match on suffix", () => {
  assert.equal(normalizePhone({ raw: "0711" }).normalized, "49711");
  // A short number must not be judged equal to a longer one via suffix.
  assert.equal(arePhonesEquivalent("456", "123456"), false);
});

test("empty and malformed strings return nulls, never throw", () => {
  assert.deepEqual(normalizePhone({ raw: "" }), {
    original: null,
    normalized: null,
  });
  assert.deepEqual(normalizePhone({ raw: "   " }), {
    original: null,
    normalized: null,
  });
  assert.deepEqual(normalizePhone({ raw: null }), {
    original: null,
    normalized: null,
  });
  const letters = normalizePhone({ raw: "abc" });
  assert.equal(letters.original, "abc");
  assert.equal(letters.normalized, null);
  assert.equal(arePhonesEquivalent("abc", "def"), false);
});

test("two unrelated numbers sharing a short suffix are not equivalent", () => {
  assert.equal(
    arePhonesEquivalent("+49 30 1110456", "+49 89 9990456"),
    false,
  );
});
