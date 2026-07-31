/**
 * Creates a production tenant: the organisation, its first admin, the routing
 * matrix and the message template catalog — the four things without which the
 * app looks installed but does nothing (no tasks are created, no message can
 * be rendered).
 *
 * `pnpm db:seed` also produces those, but it DELETES every row first: it is a
 * demo fixture, not an installer. This script only inserts, and re-running it
 * fills in whatever is missing, so it is safe to point at a live database.
 *
 * Run (owner connection, same as migrations):
 *   TENANT_NAME="…" ADMIN_EMAIL="…" ADMIN_NAME="…" ADMIN_PASSWORD="…" \
 *     pnpm bootstrap:tenant
 *
 * Optional first measure (there is no UI for measures yet):
 *   MEASURE_NAME, MEASURE_AZAV_NUMBER, MEASURE_DURATION_WEEKS,
 *   MEASURE_WEEKLY_HOURS, MEASURE_COST_EUR, MEASURE_START_DATE
 */
import { hash } from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  measures,
  messageTemplates,
  routingRules,
  tenants,
  users,
} from "@/db/schema";
import { buildTemplateRows } from "@/modules/messaging/catalog";
import { buildDefaultRoutingRules } from "@/modules/routing/default-rules";

const PASSWORD_MIN_LENGTH = 12;
const BCRYPT_COST = 10;

const databaseUrl = process.env.MIGRATION_DATABASE_URL;
if (!databaseUrl) throw new Error("MIGRATION_DATABASE_URL is not set");

const readRequired = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set`);
  return value;
};

const client = postgres(databaseUrl, { max: 1 });
const db = drizzle(client);

type BootstrapInput = {
  readonly tenantName: string;
  readonly adminEmail: string;
  readonly adminName: string;
  readonly adminPassword: string;
};

function readInput(): BootstrapInput {
  const adminPassword = readRequired("ADMIN_PASSWORD");
  if (adminPassword.length < PASSWORD_MIN_LENGTH) {
    throw new Error(
      `ADMIN_PASSWORD must be at least ${PASSWORD_MIN_LENGTH} characters`,
    );
  }
  return {
    tenantName: readRequired("TENANT_NAME"),
    adminEmail: readRequired("ADMIN_EMAIL").toLowerCase(),
    adminName: readRequired("ADMIN_NAME"),
    adminPassword,
  };
}

async function findOrCreateTenant(name: string): Promise<string> {
  const [existing] = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.name, name));
  if (existing) {
    console.log(`tenant "${name}" already exists — reusing it`);
    return existing.id;
  }
  const [created] = await db
    .insert(tenants)
    .values({ name })
    .returning({ id: tenants.id });
  console.log(`tenant "${name}" created`);
  return created.id;
}

async function ensureAdmin(
  tenantId: string,
  input: BootstrapInput,
): Promise<void> {
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(eq(users.tenantId, tenantId), eq(users.email, input.adminEmail)),
    );
  // Never silently reset a password on a re-run: an operator who wants that
  // has the "Passwort zurücksetzen" action in the user administration.
  if (existing) {
    console.log(`admin ${input.adminEmail} already exists — left untouched`);
    return;
  }
  await db.insert(users).values({
    tenantId,
    email: input.adminEmail,
    name: input.adminName,
    role: "admin",
    passwordHash: await hash(input.adminPassword, BCRYPT_COST),
  });
  console.log(`admin ${input.adminEmail} created`);
}

async function ensureRoutingRules(tenantId: string): Promise<void> {
  const existing = await db
    .select({ id: routingRules.id })
    .from(routingRules)
    .where(eq(routingRules.tenantId, tenantId));
  // All-or-nothing: a partial set would mean someone edited the matrix by hand
  // and re-adding the defaults would fight that edit.
  if (existing.length > 0) {
    console.log(`routing rules already present (${existing.length}) — skipped`);
    return;
  }
  const rules = buildDefaultRoutingRules(tenantId);
  await db.insert(routingRules).values([...rules]);
  console.log(`${rules.length} routing rules created`);
}

async function ensureMessageTemplates(tenantId: string): Promise<void> {
  const rows = buildTemplateRows().map((row) => ({ ...row, tenantId }));
  await db
    .insert(messageTemplates)
    .values(rows)
    .onConflictDoNothing({
      target: [
        messageTemplates.tenantId,
        messageTemplates.key,
        messageTemplates.channel,
      ],
    });
  console.log(`${rows.length} message templates ensured`);
}

async function ensureMeasure(tenantId: string): Promise<void> {
  const name = process.env.MEASURE_NAME?.trim();
  if (!name) return;
  const [existing] = await db
    .select({ id: measures.id })
    .from(measures)
    .where(and(eq(measures.tenantId, tenantId), eq(measures.name, name)));
  if (existing) {
    console.log(`measure "${name}" already exists — skipped`);
    return;
  }
  await db.insert(measures).values({
    tenantId,
    name,
    azavNumber: process.env.MEASURE_AZAV_NUMBER?.trim() || null,
    durationWeeks: Number(process.env.MEASURE_DURATION_WEEKS ?? 26),
    weeklyHours: Number(process.env.MEASURE_WEEKLY_HOURS ?? 20),
    costEur: process.env.MEASURE_COST_EUR?.trim() || null,
    startDate: process.env.MEASURE_START_DATE?.trim() || null,
  });
  console.log(`measure "${name}" created`);
}

async function main(): Promise<void> {
  const input = readInput();
  const tenantId = await findOrCreateTenant(input.tenantName);
  await ensureAdmin(tenantId, input);
  await ensureRoutingRules(tenantId);
  await ensureMessageTemplates(tenantId);
  await ensureMeasure(tenantId);
  console.log(`\nbootstrap complete — tenant ${tenantId}`);
  await client.end();
}

// Not top-level await: tsx transpiles a plain .ts script to CJS, which rejects it.
main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
