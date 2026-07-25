import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWaMeUrl, toWaMeNumber } from "@/modules/messaging/click-to-chat";

// The three common German spellings of the same number must all collapse to
// the bare international digits wa.me needs — reusing the shared phone rules.
test("German 0-trunk, +49, and 0049 forms all yield the same bare digits", () => {
  const expected = "497131123456";
  assert.equal(toWaMeNumber("07131 123456"), expected);
  assert.equal(toWaMeNumber("+49 7131 123456"), expected);
  assert.equal(toWaMeNumber("0049 7131 123456"), expected);
});

test("strips formatting characters (parentheses, dashes, spaces, plus)", () => {
  assert.equal(toWaMeNumber("  +49 (7131) 123-456 "), "497131123456");
});

test("keeps an already prefix-less international number untouched", () => {
  // No "+", no "00", no trunk "0" — must not guess/prepend a country code.
  assert.equal(toWaMeNumber("491511234567"), "491511234567");
});

test("honours a non-German default country code for national numbers", () => {
  assert.equal(toWaMeNumber("06 12345678", "33"), "33612345678");
});

test("returns null for empty, whitespace, or letters-only input", () => {
  assert.equal(toWaMeNumber(""), null);
  assert.equal(toWaMeNumber("   "), null);
  assert.equal(toWaMeNumber("abc"), null);
});

test("returns null for implausibly short numbers", () => {
  // "0711" → "49711" is only 5 digits: below the dialable floor.
  assert.equal(toWaMeNumber("0711"), null);
});

test("buildWaMeUrl URL-encodes the prefilled message (incl. link query)", () => {
  const url = buildWaMeUrl({
    phone: "497131123456",
    text: "Hallo Lena, Ihr Link: https://app.example.de/t/abc?x=1&y=2",
  });
  assert.equal(
    url,
    "https://wa.me/497131123456?text=Hallo%20Lena%2C%20Ihr%20Link%3A%20https%3A%2F%2Fapp.example.de%2Ft%2Fabc%3Fx%3D1%26y%3D2",
  );
});
