import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const layoutPath = new URL(
  "../../src/app/(internal)/layout.tsx",
  import.meta.url,
);
const logoPath = new URL(
  "../../public/brand/codekessel-logo.png",
  import.meta.url,
);

test("internal shell uses the local official CodeKessel wordmark", async () => {
  const [layoutSource, logo] = await Promise.all([
    readFile(layoutPath, "utf8"),
    readFile(logoPath),
  ]);
  assert.match(layoutSource, /href="\/pipeline"/);
  assert.match(layoutSource, /src="\/brand\/codekessel-logo\.png"/);
  assert.match(layoutSource, /alt="CodeKessel"/);
  assert.match(layoutSource, /aria-label="CodeKessel – QCG Antragsplattform"/);
  assert.match(layoutSource, /width=\{2560\}/);
  assert.match(layoutSource, /height=\{744\}/);
  assert.equal(logo.readUInt32BE(16), 2560);
  assert.equal(logo.readUInt32BE(20), 744);
});
