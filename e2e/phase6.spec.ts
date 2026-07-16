import { expect, test, type Page } from "@playwright/test";
import { execSync } from "node:child_process";

// Phase 6 smoke: submission readiness gate, the full submission state machine
// (internal prep → employer portal confirm → admin approval → enrolled), and
// the analytics dashboard reflecting it all.
//
// Note on timing: status changes are Next.js server actions (async RPCs, not
// navigations), so after each click we wait for the resulting DOM change
// before moving on — never navigate away mid-action.

test.describe.configure({ mode: "serial" });

const links: Record<string, string> = {};

async function signIn(page: Page, email = "berater@demo.de"): Promise<void> {
  await page.goto("/auth/sign-in");
  await page.fill("#email", email);
  await page.fill("#password", "demo1234");
  await page.click("button[type=submit]");
  await expect(page).toHaveURL(/\/pipeline/);
}

async function createApplicationFor(page: Page, name: string): Promise<void> {
  await page.goto("/documents");
  await page.getByRole("link", { name }).click();
  await page.getByRole("button", { name: "Antrag anlegen" }).click();
  // Wait for the action to commit + revalidate before leaving the page.
  await expect(page.getByText("Antrag vorhanden")).toBeVisible();
}

test.beforeAll(() => {
  // Re-seed so the funnel/KPI assertions start from a known dataset, and
  // capture the printed magic links for the external flows below.
  const output = execSync("pnpm db:seed", { encoding: "utf8" });
  const grab = (label: string): string => {
    const match = output.match(new RegExp(`${label}[^\\n]*\\n\\s+(http\\S+)`));
    if (!match) throw new Error(`Seed did not print link for ${label}`);
    return match[1];
  };
  links.availability = grab("Verfügbarkeit");
});

test("submission readiness gate blocks completion when betriebsnummer is missing", async ({
  page,
}) => {
  await signIn(page);

  // Jonas → PflegePlus: employer linked but no betriebsnummer, AG-S unconfirmed.
  await createApplicationFor(page, "Jonas Petersen");

  await page.goto("/applications");
  const row = page.locator(".data-row", { hasText: "Jonas Petersen" });
  await expect(row.getByText(/Vervollständigung blockiert/)).toBeVisible();
  await expect(
    row.getByRole("button", { name: "Als vollständig markieren" }),
  ).toHaveCount(0);
});

test("full submission flow: prepare → employer confirm → approve → enrolled", async ({
  page,
}) => {
  await signIn(page);

  // Pre-condition for approval: the 20h/6-month availability gate must be a
  // clear "yes", otherwise approving (which enrolls the participant) rolls
  // back. Lena confirms availability externally first.
  await page.goto(links.availability);
  await expect(page.locator("h1")).toContainText("Verfügbarkeit bestätigen");
  await page.getByRole("radio", { name: /Ja, 20 Stunden/ }).check();
  await page.getByRole("button", { name: "Antwort senden" }).click();
  await expect(page.locator("h1")).toContainText("Vielen Dank");

  // Lena → Nordbau: complete employer data, so the readiness gate passes.
  await createApplicationFor(page, "Lena Hoffmann");

  // in_preparation → complete (passes the readiness gate).
  await page.goto("/applications");
  const lena = () => page.locator(".data-row", { hasText: "Lena Hoffmann" });
  await lena().getByRole("button", { name: "Als vollständig markieren" }).click();
  // Revalidation flips the row to the complete-state actions.
  await expect(
    lena().getByRole("button", { name: "An Arbeitgeber senden" }),
  ).toBeVisible();

  // complete → sent_to_employer (hand-off to the employer portal).
  await lena().getByRole("button", { name: "An Arbeitgeber senden" }).click();
  await expect(lena().getByText("Beim Arbeitgeber")).toBeVisible();

  // Mint the employer confirmation link from the task board.
  await page.goto("/tasks");
  await page
    .locator(".data-row", {
      hasText: "Einreichung beim Arbeitgeberservice bestätigen",
    })
    .getByRole("button", { name: "Link erzeugen" })
    .click();
  const link = (await page.getByTestId("task-link").innerText()).trim();

  // Employer confirms submission externally → application becomes "submitted".
  await page.goto(link);
  await expect(page.locator("h1")).toContainText("Einreichung bestätigen");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Einreichung bestätigen" }).click();
  await expect(page.locator("h1")).toContainText("Vielen Dank");

  // Admin records the BA approval → participant is enrolled. Wait for the
  // status badge to flip to the approved style (terminal state, no buttons).
  await page.goto("/applications");
  await lena().getByRole("button", { name: "Bewilligt" }).click();
  await expect(lena().locator(".badge--ok")).toContainText("Bewilligt");
});

test("analytics dashboard renders KPIs and respects filters", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/reports");

  await expect(page.locator("h1")).toContainText("Berichte");

  // KPI cards render with numeric values; the seed has 10 leads.
  const leadsCard = page.locator(".kpi-card", { hasText: "Neue Leads gesamt" });
  await expect(leadsCard.locator(".kpi-value")).toContainText(/^(1?\d|20)$/);

  // The approved application from the previous test → 100 % approval rate.
  await expect(
    page
      .locator(".kpi-card", { hasText: "Bewilligungsquote" })
      .getByText("100 %"),
  ).toBeVisible();

  // The funnel reflects the flow: one participant reached "Eingeschrieben".
  await expect(
    page
      .locator(".funnel-row", { hasText: "Eingeschrieben" })
      .locator(".funnel-count"),
  ).toContainText("1");

  // Consultant filter: Anna Adler (admin) has no assigned leads.
  await page.selectOption("select[name=consultant]", "Anna Adler (Admin)");
  await page.getByRole("button", { name: "Filter anwenden" }).click();
  await expect(leadsCard.locator(".kpi-value")).toContainText(/^0$/);
});
