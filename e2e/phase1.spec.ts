import { expect, test } from "@playwright/test";
import { execSync } from "node:child_process";

// Phase 1 smoke: internal auth, RLS-backed pipeline, tokenized task loop.
// Each run re-seeds so the magic link is fresh (tokens are single-use).

function reseedAndGetMagicLink(): string {
  const output = execSync("pnpm db:seed", { encoding: "utf8" });
  const match = output.match(/http:\/\/localhost:3000\/t\/\S+/);
  if (!match) throw new Error("Seed did not print a magic link");
  return match[0];
}

test.describe.configure({ mode: "serial" });

let magicLink: string;

test.beforeAll(() => {
  magicLink = reseedAndGetMagicLink();
});

test("unauthenticated internal access redirects to sign-in", async ({ page }) => {
  await page.goto("/pipeline");
  await expect(page).toHaveURL(/\/auth\/sign-in/);
  await expect(page.locator("h1")).toContainText("Interne Anmeldung");
});

test("consultant signs in and sees the seeded pipeline", async ({ page }) => {
  await page.goto("/auth/sign-in");
  await page.fill("#email", "berater@demo.de");
  await page.fill("#password", "demo1234");
  await page.click("button[type=submit]");

  await expect(page).toHaveURL(/\/pipeline/);
  await expect(page.locator("h1")).toContainText("Pipeline");
  await expect(page.getByText("Lena Hoffmann")).toBeVisible();
  await expect(page.getByText("Fatima El-Sayed")).toBeVisible();

  await page.goto("/tasks");
  await expect(page.getByText("Lead erneut anrufen")).toBeVisible();
  await expect(page.getByText("Betriebsnummer angeben")).toBeVisible();
});

test("wrong credentials are rejected", async ({ page }) => {
  await page.goto("/auth/sign-in");
  await page.fill("#email", "berater@demo.de");
  await page.fill("#password", "falsches-passwort");
  await page.click("button[type=submit]");
  await expect(page.locator(".form-error")).toBeVisible();
});

test("magic link opens exactly one task without login and completes it", async ({
  page,
}) => {
  await page.goto(magicLink);
  await expect(page.locator("h1")).toContainText("Verfügbarkeit bestätigen");
  await expect(page.getByText("Hallo Lena")).toBeVisible();

  await page
    .getByLabel("Wahrscheinlich möglich, die Freigabe meines Arbeitgebers steht noch aus")
    .check();
  await page.getByRole("button", { name: "Antwort senden" }).click();

  await expect(page.locator("h1")).toContainText("Vielen Dank");

  // Single-use: reopening the link shows "already completed", not the form.
  await page.goto(magicLink);
  await expect(page.getByText("bereits erledigt")).toBeVisible();
});

test("routing engine created the employer follow-up task", async ({ page }) => {
  // The "probably_employer_pending" answer must have triggered the
  // "20h/Woche unbestätigt → Arbeitgeber-Link" rule.
  await page.goto("/auth/sign-in");
  await page.fill("#email", "admin@demo.de");
  await page.fill("#password", "demo1234");
  await page.click("button[type=submit]");
  await expect(page).toHaveURL(/\/pipeline/);

  await page.goto("/tasks");
  await expect(
    page.getByText("Zeitmodell 20h/Woche bestätigen"),
  ).toBeVisible();
  await expect(page.getByText("Nordbau GmbH")).toBeVisible();
});

test("invalid token shows a friendly error", async ({ page }) => {
  await page.goto("/t/kaputt-token");
  await expect(page.locator("h1")).toContainText("Link nicht mehr gültig");
});
