import assert from "node:assert/strict";
import test from "node:test";
import {
  isAptitudeTestConfigured,
  resolveAptitudeTestUrl,
} from "@/modules/aptitude-tests/config";

const PARTICIPANT_ID = "11111111-2222-3333-4444-555555555555";

test("an unset provider is not configured, so the invite can refuse", () => {
  // Explicit "" rather than undefined: undefined would fall back to the
  // ambient APTITUDE_TEST_BASE_URL through the default parameter.
  assert.equal(isAptitudeTestConfigured(""), false);
  assert.equal(isAptitudeTestConfigured("   "), false);
});

test("a configured provider carries the participant id", () => {
  assert.equal(isAptitudeTestConfigured("https://tests.example.org/start"), true);
  assert.equal(
    resolveAptitudeTestUrl(PARTICIPANT_ID, "https://tests.example.org/start"),
    `https://tests.example.org/start?participant_id=${PARTICIPANT_ID}`,
  );
});
