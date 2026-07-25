import { expect, test, type Page } from "@playwright/test";
import { execSync } from "node:child_process";

// Phase 8 smoke: pipeline filter URL-persistence, the register import happy
// path (which produces an import_runs row rendered in the run-history panel),
// and the single-use magic-link "already completed" state.
//
// These specs need the dev server + a seeded database. When that environment
// is unavailable, execution is skipped (see the report), but the specs are
// authored against the real selectors so they run as-is once a server is up.

test.describe.configure({ mode: "serial" });

let magicLink: string;

async function signIn(page: Page, email = "berater@demo.de"): Promise<void> {
  await page.goto("/auth/sign-in");
  await page.fill("#email", email);
  await page.fill("#password", "demo1234");
  await page.click("button[type=submit]");
  await expect(page).toHaveURL(/\/pipeline/);
}

test.beforeAll(() => {
  const output = execSync("pnpm db:seed", { encoding: "utf8" });
  const match = output.match(/http:\/\/localhost:3000\/t\/\S+/);
  if (!match) throw new Error("Seed did not print a magic link");
  magicLink = match[0];
});

test("pipeline filter persists in the URL and survives reload", async ({
  page,
}) => {
  await signIn(page);

  await page.getByLabel("Leads durchsuchen").fill("Lena");
  await page.getByRole("button", { name: "Filter anwenden" }).click();

  // The client filter form pushes the criterion into the query string.
  await expect(page).toHaveURL(/[?&]q=Lena/);
  await expect(page.getByText("Lena Hoffmann")).toBeVisible();

  // A hard reload must rehydrate from the URL, not reset the filter.
  await page.reload();
  await expect(page).toHaveURL(/[?&]q=Lena/);
  await expect(page.getByLabel("Leads durchsuchen")).toHaveValue("Lena");
});

test("register import happy path records a run shown in the pipeline history", async ({
  page,
}) => {
  await signIn(page, "admin@demo.de");

  await page.goto("/leads/import");
  await expect(page.locator("h1")).toContainText("Register-Import");
  await page.getByRole("button", { name: "Verlust-Unternehmen suchen" }).click();

  // Import the first still-importable company on the page.
  const firstImport = page
    .getByRole("button", { name: "Als Lead importieren" })
    .first();
  await expect(firstImport).toBeVisible();
  await firstImport.click();

  // The import server action calls the external register API — wait for its
  // redirect (the run row is committed before the redirect is served) instead
  // of navigating away mid-action.
  await expect(page).toHaveURL(/\/pipeline\?import=/);

  // The import server action writes one import_runs row (source "openregister").
  // The pipeline run-history panel surfaces it with an honest, completed state.
  await page.goto("/pipeline");
  const history = page.getByTestId("import-run-history");
  await expect(history).toBeVisible();
  await expect(history.getByText("openregister")).toBeVisible();
  await expect(history.getByText("abgeschlossen").first()).toBeVisible();
});

test("used magic link shows the already-completed state, not the form", async ({
  page,
}) => {
  await page.goto(magicLink);
  await expect(page.locator("h1")).toContainText("Verfügbarkeit bestätigen");

  await page
    .getByLabel(
      "Wahrscheinlich möglich, die Freigabe meines Arbeitgebers steht noch aus",
    )
    .check();
  await page.getByRole("button", { name: "Antwort senden" }).click();
  await expect(page.locator("h1")).toContainText("Vielen Dank");

  // Single-use credential: reopening must not re-serve the task form.
  await page.goto(magicLink);
  await expect(page.getByText("bereits erledigt")).toBeVisible();
});

test("an invalid/expired token shows a friendly error", async ({ page }) => {
  await page.goto("/t/abgelaufener-token");
  await expect(page.locator("h1")).toContainText("Link nicht mehr gültig");
});
