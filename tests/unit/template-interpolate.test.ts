import { test } from "node:test";
import assert from "node:assert/strict";
import { interpolate } from "@/modules/messaging/templates";

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
