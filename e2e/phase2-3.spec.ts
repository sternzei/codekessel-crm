import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { execSync } from "node:child_process";

// Phase 2+3 smoke: lead intake, call script outcomes, the availability gate,
// appointment lifecycle with no-show routing, aptitude-test tracking.

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  execSync("pnpm db:seed", { encoding: "utf8" });
});

async function signIn(page: Page, email = "berater@demo.de"): Promise<void> {
  await page.goto("/auth/sign-in");
  await page.fill("#email", email);
  await page.fill("#password", "demo1234");
  await page.click("button[type=submit]");
  await expect(page).toHaveURL(/\/pipeline/);
}

test("create a new lead from the pipeline", async ({ page }) => {
  await signIn(page);
  await page.getByRole("link", { name: "+ Neuer Lead" }).click();
  await expect(page).toHaveURL(/\/leads\/new/);

  await page.fill("#firstName", "Testine");
  await page.fill("#lastName", "Probandt");
  await page.fill("#phone", "+49 151 0000000");
  await page.fill("#city", "Lübeck");
  await page.getByRole("button", { name: "Lead anlegen" }).click();

  await expect(page).toHaveURL(/\/leads\/[0-9a-f-]+$/);
  await expect(page.locator("h1")).toContainText("Testine Probandt");
  await expect(page.getByText("Gesprächsleitfaden Erstkontakt")).toBeVisible();
});

test("call outcome 'Falsche Nummer' routes a task to the participant", async ({
  page,
}) => {
  await signIn(page);
  await page.getByText("Testine Probandt").click();
  await page.getByRole("button", { name: "Falsche Nummer" }).click();
  await expect(page.locator("h1 .badge")).toContainText("Falsche Nummer");

  await page.goto("/tasks");
  await expect(
    page
      .locator(".data-row", { hasText: "Testine Probandt" })
      .filter({ hasText: "Korrekte Kontaktdaten angeben" }),
  ).toBeVisible();
});

test("availability gate blocks qualification until a clear yes", async ({
  page,
}) => {
  await signIn(page);
  await page.getByText("Testine Probandt").click();

  // Attempt to qualify while availability is "unclear" → blocked.
  await page.locator("#status").selectOption("qualified");
  await page.getByRole("button", { name: "Übernehmen" }).click();
  await expect(page.locator(".gate-banner")).toBeVisible();
  await expect(page.locator("h1 .badge")).not.toContainText("Qualifiziert");

  // Record a clear yes, then qualification passes the gate.
  await page.locator("#availability").selectOption("yes");
  await page.getByRole("button", { name: "Erfassen" }).click();
  await expect(page.locator(".gate-widget")).toHaveAttribute("data-state", "yes");

  await page.locator("#status").selectOption("qualified");
  await page.getByRole("button", { name: "Übernehmen" }).click();
  await expect(page.locator("h1 .badge")).toContainText("Qualifiziert");
});

test("appointment lifecycle: schedule, then no-show triggers routing", async ({
  page,
}) => {
  await signIn(page);
  await page.getByText("Testine Probandt").click();

  const tomorrow = new Date(Date.now() + 26 * 3_600_000)
    .toISOString()
    .slice(0, 16);
  await page.fill("#apt-at", tomorrow);
  await page.getByRole("button", { name: "Termin planen" }).click();
  await expect(
    page.locator("section[aria-label=Termine] .note").first(),
  ).toContainText("Folgetermin");

  await page.goto("/appointments");
  const row = page.locator(".data-row", { hasText: "Testine Probandt" });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "No-Show" }).click();
  // Action completion is observable: the buttons disappear on revalidation.
  await expect(row.getByRole("button", { name: "No-Show" })).toBeHidden();
  await expect(row.locator(".badge")).toContainText("No-Show");

  // No-show rules: participant re-engagement + internal follow-up call.
  await page.goto("/tasks");
  await expect(page.getByText("Neuen Termin vereinbaren")).toBeVisible();
  await expect(page.getByText("No-Show nachfassen (Anruf)")).toBeVisible();
});

test("aptitude test: invite, pass, document-prep task appears", async ({
  page,
}) => {
  await signIn(page);
  await page.getByText("Testine Probandt").click();

  await page.getByRole("button", { name: "Zum Eignungstest einladen" }).click();
  await expect(
    page.locator("section[aria-label=Eignungstest] .badge"),
  ).toContainText("Eingeladen");

  await page.getByRole("button", { name: "Bestanden", exact: true }).click();
  await expect(
    page.locator("section[aria-label=Eignungstest] .badge"),
  ).toContainText("Bestanden");

  await page.goto("/tasks");
  await expect(
    page.getByText("Antragsunterlagen vorbereiten"),
  ).toBeVisible();
});

test("contact note is saved and displayed", async ({ page }) => {
  await signIn(page);
  await page.getByText("Testine Probandt").click();
  await page.fill("#note-body", "Testnotiz aus dem E2E-Lauf.");
  await page.getByRole("button", { name: "Notiz speichern" }).click();
  await expect(page.getByText("Testnotiz aus dem E2E-Lauf.")).toBeVisible();
});
