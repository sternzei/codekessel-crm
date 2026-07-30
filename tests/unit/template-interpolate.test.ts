import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findMissingVariables,
  interpolate,
  listPlaceholders,
} from "@/modules/messaging/templates";

test("replaces {{var}} placeholders with provided values", () => {
  assert.equal(
    interpolate("Hallo {{firstName}}, Ihr Termin: {{when}}", {
      firstName: "Lena",
      when: "morgen",
    }),
    "Hallo Lena, Ihr Termin: morgen",
  );
});

test("unknown placeholders collapse to empty string (never leak {{var}})", () => {
  assert.equal(interpolate("Link: {{link}}", {}), "Link: ");
});

test("leaves text without placeholders untouched", () => {
  assert.equal(interpolate("Kein Platzhalter hier.", { a: "x" }), "Kein Platzhalter hier.");
});

test("does not recurse into injected values", () => {
  // A value that itself looks like a placeholder is inserted verbatim.
  assert.equal(interpolate("{{a}}", { a: "{{b}}", b: "boom" }), "{{b}}");
});

// renderTemplate uses this to refuse a send rather than ship a sentence with a
// hole in it — an empty gap is invisible to the sender and confusing to read.
test("reports placeholders the caller did not supply", () => {
  assert.deepEqual(
    findMissingVariables("Hallo {{firstName}}: {{link}}", { firstName: "Lena" }),
    ["link"],
  );
  assert.deepEqual(findMissingVariables("Hallo {{firstName}}", { firstName: "" }), []);
});

test("lists each placeholder once, in order", () => {
  assert.deepEqual(listPlaceholders("{{a}} {{b}} {{a}}"), ["a", "b"]);
});
