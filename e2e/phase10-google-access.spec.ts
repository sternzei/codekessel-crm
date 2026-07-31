import type { Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { SignJWT } from "jose";
import postgres from "postgres";
import { expect, test } from "./fixtures";

// Phase 10: registration through Google, gated by an admin approval.
//
// The Google half of the flow cannot be driven from a test (it needs a real
// account at a real identity provider), so what is covered here is everything
// on this side of the redirect: the entry point, the review screen, the role
// rules that apply to a decision, and the rule the whole feature rests on —
// a pending account holds no session even with a perfectly valid cookie.

test.describe.configure({ mode: "serial" });

const PENDING_EMAIL = "e2e.pending@example.com";
const PENDING_NAME = "Pending Person";

// The Playwright process does not load .env.local, but the app under test does.
const envFile = readFileSync(".env.local", "utf8");
const readEnv = (key: string): string =>
  envFile.match(new RegExp(`^${key}=(.*)$`, "m"))?.[1]?.trim() ?? "";

// Owner connection: these fixtures set up rows that RLS would otherwise hide,
// and assert on the audit log the app writes.
const sql = postgres(readEnv("MIGRATION_DATABASE_URL"), { max: 1 });

const single = async (statement: string): Promise<string> => {
  const rows = await sql.unsafe(statement);
  const row = rows[0] as Record<string, unknown> | undefined;
  return row ? String(Object.values(row)[0]) : "";
};

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto("/auth/sign-in");
  await page.fill("#email", email);
  await page.fill("#password", "demo1234");
  await page.click("button[type=submit]");
  await expect(page).toHaveURL(/\/pipeline/);
}

/** A registration exactly as the Google callback would have left it. */
const createPendingUser = async (): Promise<{
  id: string;
  tenantId: string;
}> => {
  const tenantId = await single("select id from tenants limit 1");
  await sql.unsafe(`delete from users where email = '${PENDING_EMAIL}'`);
  const id = await single(
    `insert into users (tenant_id, email, name, role, google_subject,
       email_verified_at, access_status, active)
     values ('${tenantId}', '${PENDING_EMAIL}', '${PENDING_NAME}', 'consultant',
       'e2e-google-subject', now(), 'pending', true)
     returning id`,
  );
  return { id, tenantId };
};

test.beforeAll(() => {
  execSync("pnpm db:seed", { encoding: "utf8" });
});

test.afterAll(async () => {
  await sql.end();
});

test("the sign-in page offers Google when it is configured", async ({ page }) => {
  await page.goto("/auth/sign-in");

  const button = page.getByRole("link", { name: "Mit Google anmelden" });
  await expect(button).toBeVisible();
  await expect(button).toHaveAttribute("href", "/auth/google/start");
});

test("the flow starts with state, nonce and PKCE", async ({ page }) => {
  const response = await page.request.get("/auth/google/start", {
    maxRedirects: 0,
  });
  const location = response.headers()["location"] ?? "";
  const params = new URL(location).searchParams;

  expect(location).toContain("https://accounts.google.com/");
  expect(params.get("code_challenge_method")).toBe("S256");
  expect(params.get("scope")).toBe("openid email profile");
  for (const key of ["state", "nonce", "code_challenge"]) {
    expect(params.get(key)?.length ?? 0).toBeGreaterThan(20);
  }
});

test("a callback with the wrong state is refused", async ({ page }) => {
  // No flow cookie, so nothing can match — the case an attacker would create
  // by feeding a victim their own authorization code.
  const response = await page.request.get(
    "/auth/google/callback?state=forged&code=forged",
    { maxRedirects: 0 },
  );

  expect(response.headers()["location"]).toContain("/auth/sign-in?error=google");
});

test("a pending account cannot hold a session", async ({ page, context }) => {
  const { id, tenantId } = await createPendingUser();

  // A cookie that is genuinely valid: same secret, same claims the app mints
  // on a successful login. Only the database says "not approved".
  const token = await new SignJWT({
    tid: tenantId,
    email: PENDING_EMAIL,
    name: PENDING_NAME,
    role: "consultant",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(id)
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(new TextEncoder().encode(readEnv("AUTH_SECRET")));

  await context.addCookies([
    {
      name: "qcg_session",
      value: token,
      domain: "localhost",
      path: "/",
      httpOnly: true,
    },
  ]);

  await page.goto("/pipeline");
  await expect(page).toHaveURL(/\/auth\/sign-in/);
});

test("an admin approves a request and picks the role", async ({ page }) => {
  const { id } = await createPendingUser();
  await signIn(page, "admin@demo.de");
  await page.goto("/users");

  await expect(page.getByText("Zugriffsanfragen")).toBeVisible();
  const request = page.locator(".data-row").filter({ hasText: PENDING_EMAIL });
  await expect(request).toBeVisible();

  await request.locator("select").selectOption("manager");
  await request.getByRole("button", { name: "Freigeben" }).click();

  await expect(page.getByText("Zugriff freigegeben.")).toBeVisible();
  expect(await single(`select access_status from users where id = '${id}'`)).toBe(
    "approved",
  );
  expect(await single(`select role from users where id = '${id}'`)).toBe("manager");
  expect(
    await single(
      `select count(*) from activity_log where subject_id = '${id}' and event = 'user_access_approved'`,
    ),
  ).toBe("1");

  // It is now a normal account rather than a request.
  await expect(
    page.locator(".data-row").filter({ hasText: PENDING_EMAIL }),
  ).toContainText("Google-Anmeldung");
});

test("an admin rejects a request and the account stays locked out", async ({
  page,
}) => {
  const { id } = await createPendingUser();
  await signIn(page, "admin@demo.de");
  await page.goto("/users");

  const request = page.locator(".data-row").filter({ hasText: PENDING_EMAIL });
  await request.getByRole("button", { name: "Ablehnen" }).click();

  await expect(page.getByText("Anfrage abgelehnt.")).toBeVisible();
  expect(await single(`select access_status from users where id = '${id}'`)).toBe(
    "rejected",
  );
  expect(await single(`select active from users where id = '${id}'`)).toBe("false");
  await expect(
    page.locator(".data-row").filter({ hasText: PENDING_EMAIL }),
  ).toContainText("Abgelehnt");
});

test("a consultant never sees the review queue", async ({ page }) => {
  await createPendingUser();
  await signIn(page, "berater@demo.de");

  await page.goto("/users");

  await expect(page).toHaveURL(/\/pipeline/);
});

test("a manager may approve, but not into the admin role", async ({ page }) => {
  await createPendingUser();
  await signIn(page, "leitung@demo.de");
  await page.goto("/users");

  const request = page.locator(".data-row").filter({ hasText: PENDING_EMAIL });
  const roleOptions = await request.locator("select option").allInnerTexts();

  expect(roleOptions).toEqual(["Beratung", "Teamleitung"]);
});
