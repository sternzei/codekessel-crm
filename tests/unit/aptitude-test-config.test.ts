import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveAptitudeTestUrl } from "@/modules/aptitude-tests/config";

test("falls back to the demo aptitude-test URL when no provider is configured", () => {
  assert.equal(
    resolveAptitudeTestUrl("participant-1", ""),
    "https://example.com/eignungstest-platzhalter",
  );
});

test("adds the participant id to a configured aptitude-test provider URL", () => {
  assert.equal(
    resolveAptitudeTestUrl(
      "7f2f3b88-3087-4c71-a7f2-9621dcf4576a",
      "https://tests.example.org/start?campaign=qcg",
    ),
    "https://tests.example.org/start?campaign=qcg&participant_id=7f2f3b88-3087-4c71-a7f2-9621dcf4576a",
  );
});

