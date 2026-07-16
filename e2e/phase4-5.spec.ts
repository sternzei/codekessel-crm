import { expect, test, type Page } from "@playwright/test";
import { execSync } from "node:child_process";

// Phase 4+5 smoke: employer setup assistant, participant task pages,
// document generation from central data, canvas signature with audit trail.

test.describe.configure({ mode: "serial" });

const links: Record<string, string> = {};

test.beforeAll(() => {
  const output = execSync("pnpm db:seed", { encoding: "utf8" });
  const grab = (label: string): string => {
    const match = output.match(
      new RegExp(`${label}[^\\n]*\\n\\s+(http\\S+)`),
    );
    if (!match) throw new Error(`Seed did not print link for ${label}`);
    return match[1];
  };
  links.availability = grab("Verfügbarkeit");
  links.contact = grab("Kontaktdaten korrigieren");
  links.employer = grab("Arbeitgeber-Setup");
  links.test = grab("Eignungstest starten");
});

async function signIn(page: Page, email = "berater@demo.de"): Promise<void> {
  await page.goto("/auth/sign-in");
  await page.fill("#email", email);
  await page.fill("#password", "demo1234");
  await page.click("button[type=submit]");
  await expect(page).toHaveURL(/\/pipeline/);
}

test("employer setup assistant completes all four steps", async ({ page }) => {
  await page.goto(links.employer);
  await expect(page.locator("h1")).toContainText("Angaben für die Förderung");
  // Steps 1, 2, 4 are open; step 3 (contact) was pre-filled in the seed.
  await expect(
    page.locator('.wizard-step[data-done="false"]').first(),
  ).toBeVisible();

  await page.fill("#betriebsnummer", "55443322");
  await page.locator("#agsRegistered").selectOption("yes");
  await page.fill("#agsContactName", "Frau Wagner (AG-S Bremen)");
  await page.locator("#timeModel").selectOption("yes");
  await page.getByRole("button", { name: "Angaben speichern" }).click();

  await expect(page.locator("h1")).toContainText("Vielen Dank");

  // Single-use once complete: reopening shows "already done".
  await page.goto(links.employer);
  await expect(page.getByText("bereits erledigt")).toBeVisible();

  // Internally: employer derived status is "confirmed".
  await signIn(page);
  await page.goto("/employers");
  const row = page.locator(".data-row", { hasText: "PflegePlus" });
  await expect(row.getByText("Bestätigt")).toBeVisible();
});

test("employer setup assistant keeps the link valid on partial saves", async ({
  page,
}) => {
  // City Logistik: create a setup link internally, then submit only step 1.
  await signIn(page);
  await page.goto("/employers");
  await page
    .locator(".data-row", { hasText: "City Logistik" })
    .getByRole("button", { name: "Setup-Link erzeugen" })
    .click();
  const link = await page.getByTestId("setup-link").innerText();

  await page.goto(link.trim());
  // Only the time-model step is still open for City Logistik; a non-final
  // answer ("partial") must save without completing the setup.
  await page.locator("#timeModel").selectOption("partial");
  await page.getByRole("button", { name: "Angaben speichern" }).click();

  // Partial: wizard re-opens with saved state instead of burning the token.
  await expect(page.getByText("Zwischenstand gespeichert")).toBeVisible();
  await expect(page.locator("h1")).toContainText("Angaben für die Förderung");
});

test("participant fixes contact details, consultant gets a call task", async ({
  page,
}) => {
  await page.goto(links.contact);
  await expect(page.locator("h1")).toContainText("Kontaktdaten aktualisieren");
  await page.fill("#phone", "+49 151 7654321");
  await page.getByRole("button", { name: "Daten senden" }).click();
  await expect(page.locator("h1")).toContainText("Vielen Dank");

  await signIn(page);
  await page.goto("/tasks");
  await expect(
    page.getByText("Lead erneut anrufen (Kontaktdaten aktualisiert)"),
  ).toBeVisible();
});

test("aptitude test link starts the test and forwards to the test URL", async ({
  page,
}) => {
  await page.goto(links.test);
  await expect(page.locator("h1")).toContainText("Eignungstest starten");
  await page.getByRole("button", { name: "Test jetzt starten" }).click();
  await page.waitForURL(/example\.com/);
});

test("document is generated from central data and canvas-signed", async ({
  page,
}) => {
  await signIn(page);

  // Lena: generate the cost overview (data complete → prefilled).
  await page.goto("/documents");
  await page.getByRole("link", { name: "Lena Hoffmann" }).click();
  await page.getByRole("button", { name: "Kostenübersicht" }).click();
  const docCard = page.locator(".note", { hasText: "Kostenübersicht" });
  await expect(docCard.getByText("Vorbefüllt")).toBeVisible();
  await expect(docCard.getByRole("link", { name: "PDF öffnen" })).toBeVisible();

  // AcroForm autofill path (mode A): Lena's data is complete.
  await page
    .getByRole("button", { name: "Teilnehmer-Stammblatt (Autofill)" })
    .click();
  await expect(
    page
      .locator(".note", { hasText: "Teilnehmer-Stammblatt" })
      .getByText("Vorbefüllt"),
  ).toBeVisible();

  // Request the participant signature; rule creates task + link + reminders.
  await docCard.getByRole("button", { name: "Signatur: Teilnehmer:in" }).click();
  await expect(docCard.getByText("Signatur (Teilnehmer:in): ausstehend")).toBeVisible();

  // Mint the signer link from the task board.
  await page.goto("/tasks");
  await page
    .locator(".data-row", { hasText: "Dokument unterschreiben" })
    .getByRole("button", { name: "Link erzeugen" })
    .click();
  const link = (await page.getByTestId("task-link").innerText()).trim();

  // Sign externally: name, drawn signature, confirmation.
  await page.goto(link);
  await expect(page.locator("h1")).toContainText("Dokument unterschreiben");
  await expect(
    page.getByRole("link", { name: "Dokument ansehen (PDF)" }),
  ).toBeVisible();

  const canvas = page.locator("canvas.signature-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("canvas not visible");
  await page.mouse.move(box.x + 30, box.y + 80);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + 40, { steps: 10 });
  await page.mouse.move(box.x + 200, box.y + 100, { steps: 10 });
  await page.mouse.up();

  await page.getByLabel(/Ich bestätige/).check();
  await page.getByRole("button", { name: "Jetzt unterschreiben" }).click();
  await expect(page.locator("h1")).toContainText("Vielen Dank");

  // Audit trail visible internally; document is signed (session persists).
  await page.goto("/documents");
  await page.getByRole("link", { name: "Lena Hoffmann" }).click();
  await expect(page.getByText("Signiert")).toBeVisible();
  await expect(page.getByText(/✓ Lena Hoffmann/)).toBeVisible();
});

test("missing data creates a data_missing document plus a clarification task", async ({
  page,
}) => {
  await signIn(page);

  // Tarek has no measure/date of birth → participant form cannot be filled.
  await page.goto("/documents");
  await page.getByRole("link", { name: "Tarek Aziz" }).click();
  await page
    .getByRole("button", { name: "Teilnehmer-Stammblatt (Autofill)" })
    .click();
  await expect(
    page
      .locator(".note", { hasText: "Teilnehmer-Stammblatt" })
      .getByText("Daten fehlen"),
  ).toBeVisible();

  await page.goto("/tasks");
  await expect(
    page.getByText("Fehlende Dokumentdaten ergänzen"),
  ).toBeVisible();
});
