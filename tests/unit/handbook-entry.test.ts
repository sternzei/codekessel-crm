import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { HANDBOOK_ROOT, resolveHandbookAsset } from "@/modules/handbook/assets";

const layoutPath = new URL(
  "../../src/app/(internal)/layout.tsx",
  import.meta.url,
);
const helpLinkPath = new URL(
  "../../src/components/help/help-link.tsx",
  import.meta.url,
);
const helpPagePath = new URL(
  "../../src/app/(internal)/hilfe/page.tsx",
  import.meta.url,
);
const helpCenterPath = new URL(
  "../../src/components/help/help-center.tsx",
  import.meta.url,
);
const academyRoutePath = new URL(
  "../../src/app/(internal)/hilfe/academy/[[...path]]/route.ts",
  import.meta.url,
);

test("Hilfe nav stays on the in-app help page", async () => {
  const layoutSource = await readFile(layoutPath, "utf8");
  assert.match(layoutSource, /href: "\/hilfe", label: t\("help"\)/);
});

test("sidebar includes Hilfe / Academy as a new-tab item", async () => {
  const layoutSource = await readFile(layoutPath, "utf8");
  assert.match(layoutSource, /href: "\/hilfe\/academy"/);
  assert.match(layoutSource, /label: t\("academy"\)/);
  assert.match(layoutSource, /openInNewTab: true/);
});

test("contextual help links stay on the in-app help page", async () => {
  const source = await readFile(helpLinkPath, "utf8");
  assert.match(source, /href=\{`\/hilfe\?topic=/);
  assert.doesNotMatch(source, /target="_blank"/);
});

test("the in-app help page is restored", async () => {
  const source = await readFile(helpPagePath, "utf8");
  assert.match(source, /HelpCenter/);
});

test("the help page opens the academy in a new tab", async () => {
  const [centerSource, routeSource] = await Promise.all([
    readFile(helpCenterPath, "utf8"),
    readFile(academyRoutePath, "utf8"),
  ]);
  assert.match(centerSource, /href="\/hilfe\/academy"/);
  assert.match(centerSource, /target="_blank"/);
  assert.match(centerSource, /rel="noopener noreferrer"/);
  assert.match(routeSource, /HANDBOOK_BASE_HREF = "\/hilfe\/academy\/"/);
});

test("the packaged academy handbook is present", async () => {
  const index = await readFile(
    new URL("../../content/academy/index.html", import.meta.url),
    "utf8",
  );
  assert.match(index, /QCG CRM Academy/);
  assert.match(index, /window\.__ACADEMY__/);
  const asset = resolveHandbookAsset({ root: HANDBOOK_ROOT, segments: [] });
  assert.ok(asset);
  assert.equal(asset.isHtml, true);
  const screenshot = resolveHandbookAsset({
    root: HANDBOOK_ROOT,
    segments: ["assets", "webp", "01-sign-in.webp"],
  });
  assert.ok(screenshot);
  assert.equal(screenshot.contentType, "image/webp");
});
