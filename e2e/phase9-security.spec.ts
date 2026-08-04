import type { Page } from "@playwright/test";
import { baseUrl, expect, onBaseUrl, test } from "./fixtures";
import { execSync } from "node:child_process";

// Phase 9 smoke: trust boundaries (Sprint 2 hardening).
//  1. Login brute-force guard keys on the proxy-appended (LAST)
//     x-forwarded-for entry — rotating the client-controlled front entries
//     must not mint a fresh bucket.
//  2. Pipeline CSV export escapes spreadsheet formula injection.
//  3. The external upload flow validates magic bytes BEFORE burning the task:
//     a fake .png is rejected with ?error=1 (task stays alive), a real PNG
//     completes it.
//
// Requires TRUST_PROXY=true in the dev server env (.env.local) — without it
// every caller shares one fail-closed bucket and test 1 cannot observe
// per-IP keying.

test.describe.configure({ mode: "serial" });


async function signIn(page: Page, email = "berater@demo.de"): Promise<void> {
  await page.goto("/auth/sign-in");
  await page.fill("#email", email);
  await page.fill("#password", "demo1234");
  await page.click("button[type=submit]");
  await expect(page).toHaveURL(/\/pipeline/);
}

test.beforeAll(() => {
  execSync("pnpm db:seed", { encoding: "utf8" });
});

test("login rate limit keys on the last x-forwarded-for entry", async ({
  browser,
}) => {
  // TEST-NET-3: per-run random last hop so the in-memory bucket (5 min
  // window, dev-server process) is guaranteed fresh on re-runs.
  const lastHop = `203.0.113.${Math.floor(Math.random() * 200) + 10}`;
  const openLogin = async (xff: string) => {
    const context = await browser.newContext({
      baseURL: baseUrl,
      extraHTTPHeaders: { "x-forwarded-for": xff },
    });
    return context.newPage();
  };
  const failOnce = async (page: Page) => {
    await page.goto("/auth/sign-in");
    await page.fill("#email", "berater@demo.de");
    await page.fill("#password", "definitely-wrong");
    await page.click("button[type=submit]");
    await expect(page).toHaveURL(/\/auth\/sign-in\?error=/);
  };

  // Ten failed attempts from one last-hop IP exhaust the budget…
  const attacker = await openLogin(`198.51.100.7, ${lastHop}`);
  for (let i = 0; i < 10; i += 1) await failOnce(attacker);
  await expect(attacker).toHaveURL(/error=1$/);

  // …the 11th is throttled…
  await failOnce(attacker);
  await expect(attacker).toHaveURL(/error=rate/);

  // …and rotating the client-controlled FRONT entries does not evade it:
  // the bucket follows the proxy-appended LAST entry.
  const spoofer = await openLogin(`192.0.2.99, 10.0.0.1, ${lastHop}`);
  await failOnce(spoofer);
  await expect(spoofer).toHaveURL(/error=rate/);

  // Sanity: a different last hop still gets a fresh bucket.
  const other = await openLogin(`192.0.2.99, 203.0.113.9`);
  await failOnce(other);
  await expect(other).toHaveURL(/error=1$/);
});

test("pipeline CSV export escapes formula injection", async ({ page }) => {
  await signIn(page);
  await page.goto("/leads/new");
  await page.fill("#firstName", '=HYPERLINK("https://evil.example","x")');
  await page.fill("#lastName", "Csvprobe");
  await page.getByRole("button", { name: "Lead anlegen" }).click();
  await expect(page).toHaveURL(/\/leads\/[0-9a-f-]{36}/);

  const response = await page.request.get("/api/pipeline/export");
  expect(response.ok()).toBeTruthy();
  const csv = await response.text();
  // Dangerous leading '=' is defused by a single-quote prefix.
  expect(csv).toContain("'=HYPERLINK(");
  expect(csv).not.toMatch(/[^']"=HYPERLINK/);
});

test("upload flow rejects fake PNGs before burn, accepts real ones", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/leads/new");
  await page.fill("#firstName", "Upload");
  await page.fill("#lastName", "Probe");
  await page.getByRole("button", { name: "Lead anlegen" }).click();
  await expect(page).toHaveURL(/\/leads\/[0-9a-f-]{36}/);

  await page.getByRole("button", { name: "Upload-Link erzeugen" }).click();
  const uploadHref = await page
    .locator(".info-banner a", { hasText: "/t/" })
    .getAttribute("href");
  if (!uploadHref) throw new Error("no upload link minted");
  const uploadLink = onBaseUrl(uploadHref);

  // Fake PNG: right extension + MIME, garbage bytes → rejected, task NOT
  // burned (validation happens before the burn gate).
  await page.goto(uploadLink);
  await expect(page.locator("h1")).toContainText("Unterlagen hochladen");
  await page.locator("#files").setInputFiles({
    name: "nachweis.png",
    mimeType: "image/png",
    buffer: Buffer.from("this is definitely not a png"),
  });
  await page.getByRole("button", { name: "Hochladen" }).click();
  await expect(page).toHaveURL(/\/t\/.+\?error=1/);
  await expect(page.locator("h1")).toContainText("Das hat nicht geklappt");

  // The task survived: the same link still serves the form, and a genuine
  // 1x1 PNG completes it.
  await page.goto(uploadLink);
  await expect(page.locator("h1")).toContainText("Unterlagen hochladen");
  await page.locator("#files").setInputFiles({
    name: "nachweis.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      "base64",
    ),
  });
  await page.getByRole("button", { name: "Hochladen" }).click();
  await expect(page.locator("h1")).toContainText("Vielen Dank");
});
