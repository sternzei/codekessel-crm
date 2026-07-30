import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const layoutPath = new URL(
  "../../src/app/(internal)/layout.tsx",
  import.meta.url,
);
const wordmarkPath = new URL(
  "../../public/brand/codekessel-wordmark-on-dark.png",
  import.meta.url,
);

test("internal shell uses the local official CodeKessel wordmark", async () => {
  const [layoutSource, wordmark] = await Promise.all([
    readFile(layoutPath, "utf8"),
    readFile(wordmarkPath),
  ]);
  assert.match(layoutSource, /href="\/pipeline"/);
  assert.match(
    layoutSource,
    /src="\/brand\/codekessel-wordmark-on-dark\.png"/,
  );
  assert.match(layoutSource, /alt="CodeKessel"/);
  assert.match(
    layoutSource,
    /aria-label="CodeKessel – Antragsplattform"/,
  );
  assert.match(layoutSource, /width=\{1024\}/);
  assert.match(layoutSource, /height=\{298\}/);
  assert.equal(wordmark.readUInt32BE(16), 1024);
  assert.equal(wordmark.readUInt32BE(20), 298);
});
