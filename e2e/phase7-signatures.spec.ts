import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { execSync } from "node:child_process";

// Multi-signer completion + signed artifact: a document with two requested
// signers stays "partially signed" until both sign, then produces a signed
// PDF (stamp + audit certificate) that the internal download serves.

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

async function drawAndSign(page: Page, link: string): Promise<void> {
  await page.goto(link);
  await expect(page.locator("h1")).toContainText("Dokument unterschreiben");
  // The route streams behind a loading.tsx fallback, so wait for the pad to be
  // laid out before measuring it — boundingBox() does not retry on its own.
  const canvas = page.locator("canvas.signature-canvas");
  await expect(canvas).toBeVisible();
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
}

async function mintLink(page: Page, ownerLabel: string): Promise<string> {
  await page.goto("/tasks");
  await page
    .locator(".data-row", { hasText: "Dokument unterschreiben" })
    .filter({ hasText: ownerLabel })
    .getByRole("button", { name: "Link erzeugen" })
    .click();
  return (await page.getByTestId("task-link").innerText()).trim();
}

test("co-signed document completes only after both signers sign", async ({
  page,
}) => {
  await signIn(page);

  // Lena Hoffmann is linked to Nordbau GmbH → the cost overview carries an
  // employerId, so both signer buttons appear.
  await page.goto("/documents");
  await page.getByRole("link", { name: "Lena Hoffmann" }).click();
  await page.getByRole("button", { name: "Lehrgangskosten-Nachweis" }).click();

  const docCard = page.locator(".note", { hasText: "Kostenübersicht" });
  await expect(docCard.getByText("Vorbefüllt")).toBeVisible();

  // Request BOTH signers before either signs.
  await docCard.getByRole("button", { name: "Signatur: Teilnehmer:in" }).click();
  await expect(
    docCard.getByText("Signatur (Teilnehmer:in): ausstehend"),
  ).toBeVisible();
  await docCard.getByRole("button", { name: "Signatur: Arbeitgeber" }).click();
  await expect(
    docCard.getByText("Signatur (Arbeitgeber): ausstehend"),
  ).toBeVisible();

  // Participant link: consultant can mint. Employer tasks are manager/admin-only.
  const participantLink = await mintLink(page, "Teilnehmer:in");
  await page.getByRole("button", { name: "Abmelden" }).click();
  await signIn(page, "leitung@demo.de");
  const employerLink = await mintLink(page, "Arbeitgeber");

  // First signature → document is only PARTIALLY signed.
  await drawAndSign(page, participantLink);
  await page.goto("/documents");
  await page.getByRole("link", { name: "Lena Hoffmann" }).click();
  const cardAfterFirst = page.locator(".note", { hasText: "Kostenübersicht" });
  await expect(cardAfterFirst.getByText("Teilweise signiert")).toBeVisible();
  await expect(cardAfterFirst.getByText("Signiert", { exact: true })).toHaveCount(0);

  // Second signature → fully signed, signed artifact produced.
  await drawAndSign(page, employerLink);
  await page.goto("/documents");
  await page.getByRole("link", { name: "Lena Hoffmann" }).click();
  const cardAfterBoth = page.locator(".note", { hasText: "Kostenübersicht" });
  await expect(cardAfterBoth.getByText("Signiert", { exact: true })).toBeVisible();
  await expect(cardAfterBoth.getByText(/✓ Lena Hoffmann/)).toBeVisible();
  await expect(cardAfterBoth.getByText(/✓ Petra Schmidt/)).toBeVisible();

  // The internal download serves the signed artifact with visible stamps.
  const href = await cardAfterBoth
    .getByRole("link", { name: "Signiertes PDF öffnen" })
    .getAttribute("href");
  if (!href) throw new Error("no download link");
  const res = await page.request.get(href);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("application/pdf");
  const pdfBytes = Buffer.from(await res.body());
  expect(pdfBytes.subarray(0, 4).toString("latin1")).toBe("%PDF");
  // Content streams are Flate-compressed, so assert structural proof instead:
  // each canvas signature is embedded as a PNG Image XObject (+ soft mask).
  const { PDFDocument } = await import("pdf-lib");
  const signedDoc = await PDFDocument.load(pdfBytes);
  // Original page(s) + Unterschriften-Nachweis appendix.
  expect(signedDoc.getPageCount()).toBeGreaterThanOrEqual(2);
  const pdfLatin1 = pdfBytes.toString("latin1");
  const imageXObjects = pdfLatin1.match(/\/Subtype \/Image/g) ?? [];
  expect(imageXObjects.length).toBeGreaterThanOrEqual(4); // 2 signatures × (image + mask)
  expect(pdfLatin1).toMatch(/\/Width 494/);
  expect(pdfLatin1).toMatch(/\/Height 160/);
});
