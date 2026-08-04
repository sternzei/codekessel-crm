/**
 * Fills a live tenant with a believable pipeline for demos and walkthroughs.
 *
 * `db:seed` cannot be used for this: it DELETES every table first, including
 * `users`, so pointing it at a real database removes the accounts that were
 * just bootstrapped. This script only inserts, and every participant it creates
 * carries `source = 'demo'` so the whole set can be identified and removed
 * again — which `--remove` does.
 *
 * Run (owner connection, same as migrations):
 *   DEMO_OWNER_EMAIL="someone@example.com" pnpm seed:demo
 *
 * Remove it again:
 *   DEMO_OWNER_EMAIL="someone@example.com" pnpm seed:demo --remove
 */
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  appointments,
  employers,
  measures,
  participants,
  tasks,
  users,
} from "@/db/schema";

const DEMO_SOURCE = "demo";
const MEASURE_NAME = "Datenkompetenz & KI im Arbeitsalltag";
const DEMO_COMPANIES = [
  "Stadtbäckerei Krause GmbH",
  "Nordlicht Logistik GmbH",
] as const;
const DAY_MS = 24 * 60 * 60 * 1000;

const databaseUrl = process.env.MIGRATION_DATABASE_URL;
if (!databaseUrl) throw new Error("MIGRATION_DATABASE_URL is not set");

const ownerEmail = process.env.DEMO_OWNER_EMAIL?.trim().toLowerCase();
if (!ownerEmail) throw new Error("DEMO_OWNER_EMAIL is not set");

const client = postgres(databaseUrl, { max: 1 });
const db = drizzle(client);

type Owner = { readonly id: string; readonly tenantId: string };

const daysFromNow = (days: number): Date => new Date(Date.now() + days * DAY_MS);

async function findOwner(): Promise<Owner> {
  const [row] = await db
    .select({ id: users.id, tenantId: users.tenantId })
    .from(users)
    .where(eq(users.email, ownerEmail!));
  if (!row) throw new Error(`no user with email ${ownerEmail}`);
  return row;
}

async function findDemoParticipantIds(tenantId: string): Promise<string[]> {
  const rows = await db
    .select({ id: participants.id })
    .from(participants)
    .where(
      and(
        eq(participants.tenantId, tenantId),
        eq(participants.source, DEMO_SOURCE),
      ),
    );
  return rows.map((row) => row.id);
}

/** Deletes children first: every one of these carries a foreign key home. */
async function removeDemoData(owner: Owner): Promise<void> {
  const ids = await findDemoParticipantIds(owner.tenantId);
  if (ids.length === 0) {
    console.log("no demo data found — nothing to remove");
    return;
  }
  await db
    .delete(tasks)
    .where(
      and(eq(tasks.subjectKind, "participant"), inArray(tasks.subjectId, ids)),
    );
  await db.delete(appointments).where(inArray(appointments.participantId, ids));
  await db.delete(participants).where(inArray(participants.id, ids));
  await db
    .delete(employers)
    .where(
      and(
        eq(employers.tenantId, owner.tenantId),
        inArray(employers.companyName, [...DEMO_COMPANIES]),
      ),
    );
  await db
    .delete(measures)
    .where(
      and(eq(measures.tenantId, owner.tenantId), eq(measures.name, MEASURE_NAME)),
    );
  console.log(`removed ${ids.length} demo participants and their records`);
}

async function ensureMeasure(tenantId: string): Promise<string> {
  const [existing] = await db
    .select({ id: measures.id })
    .from(measures)
    .where(and(eq(measures.tenantId, tenantId), eq(measures.name, MEASURE_NAME)));
  if (existing) return existing.id;
  const [created] = await db
    .insert(measures)
    .values({
      tenantId,
      name: MEASURE_NAME,
      azavNumber: "AZAV-2026-0417",
      durationWeeks: 26,
      weeklyHours: 20,
      format: "hybrid",
      costEur: "7480.00",
      startDate: "2026-09-01",
      targetGroup: "Beschäftigte ohne formalen IT-Abschluss",
      objective: "Qualifizierung nach § 82 SGB III",
    })
    .returning({ id: measures.id });
  return created.id;
}

async function createEmployers(tenantId: string): Promise<string[]> {
  const rows = await db
    .insert(employers)
    .values([
      {
        tenantId,
        companyName: DEMO_COMPANIES[0],
        status: "time_model_pending" as const,
        street: "Lindenstraße 14",
        postalCode: "28195",
        city: "Bremen",
        industry: "Lebensmittelhandwerk",
        employeeCount: 34,
        contactName: "Birgit Krause",
        contactRole: "Geschäftsführung",
        contactEmail: "krause@example.com",
        contactPhone: "+49 421 5512340",
        betriebsnummer: "12345678",
        timeModelStatus: "unclear" as const,
      },
      {
        tenantId,
        companyName: DEMO_COMPANIES[1],
        status: "confirmed" as const,
        street: "Am Hafen 3",
        postalCode: "24103",
        city: "Kiel",
        industry: "Logistik",
        employeeCount: 120,
        contactName: "Ole Petersen",
        contactRole: "Personalleitung",
        contactEmail: "petersen@example.com",
        contactPhone: "+49 431 7788910",
        betriebsnummer: "87654321",
        agsRegistered: true,
        trainingSupportConfirmed: true,
        timeModelStatus: "yes" as const,
      },
    ])
    .returning({ id: employers.id });
  return rows.map((row) => row.id);
}

type Lead = {
  readonly firstName: string;
  readonly lastName: string;
  readonly city: string;
  readonly status: (typeof participants.status.enumValues)[number];
  readonly availability: (typeof participants.availabilityStatus.enumValues)[number];
  readonly employerIndex?: number;
  readonly notes?: string;
};

// One lead per stage, so the board reads as a funnel rather than a heap.
const LEADS: readonly Lead[] = [
  { firstName: "Yusuf", lastName: "Demir", city: "Bremen", status: "new", availability: "unclear" },
  { firstName: "Anna", lastName: "Weber", city: "Kiel", status: "called", availability: "unclear" },
  {
    firstName: "Michael",
    lastName: "Braun",
    city: "Hamburg",
    status: "not_reachable",
    availability: "unclear",
    notes: "Dreimal versucht, jeweils Mailbox.",
  },
  { firstName: "Sabine", lastName: "Klein", city: "Lübeck", status: "interested", availability: "yes" },
  {
    firstName: "Tobias",
    lastName: "Richter",
    city: "Bremen",
    status: "eligibility_unclear",
    availability: "partial",
    notes: "Schichtdienst — 20h/Woche nur mit Anpassung des Dienstplans.",
  },
  {
    firstName: "Elif",
    lastName: "Yilmaz",
    city: "Bremen",
    status: "employer_pending",
    availability: "probably_employer_pending",
    employerIndex: 0,
    notes: "Arbeitgeber prüft Freistellung.",
  },
  {
    firstName: "Marek",
    lastName: "Nowak",
    city: "Kiel",
    status: "qualified",
    availability: "yes",
    employerIndex: 1,
  },
  { firstName: "Laura", lastName: "Schäfer", city: "Kiel", status: "test_phase", availability: "yes", employerIndex: 1 },
  {
    firstName: "Daniel",
    lastName: "Fischer",
    city: "Hamburg",
    status: "documents_phase",
    availability: "yes",
    employerIndex: 1,
  },
  {
    firstName: "Nadia",
    lastName: "Haddad",
    city: "Bremen",
    status: "application_phase",
    availability: "yes",
    employerIndex: 1,
  },
  { firstName: "Sven", lastName: "Koch", city: "Kiel", status: "enrolled", availability: "yes", employerIndex: 1 },
  {
    firstName: "Petra",
    lastName: "Lang",
    city: "Hamburg",
    status: "lost",
    availability: "not_possible",
    notes: "Kein Interesse an Weiterbildung.",
  },
];

async function createParticipants(
  owner: Owner,
  measureId: string,
  employerIds: readonly string[],
): Promise<{ readonly id: string; readonly status: string }[]> {
  const values = LEADS.map((lead, index) => ({
    tenantId: owner.tenantId,
    status: lead.status,
    firstName: lead.firstName,
    lastName: lead.lastName,
    email: `${lead.firstName.toLowerCase()}.${lead.lastName.toLowerCase()}@example.com`,
    phone: `+49 170 ${5500000 + index}`,
    city: lead.city,
    employmentStatus: "employed" as const,
    availabilityStatus: lead.availability,
    eligibilityNotes: lead.notes ?? null,
    source: DEMO_SOURCE,
    employerId:
      lead.employerIndex === undefined ? null : employerIds[lead.employerIndex],
    measureId: lead.status === "new" ? null : measureId,
    assignedConsultantId: owner.id,
  }));
  return db
    .insert(participants)
    .values(values)
    .returning({ id: participants.id, status: participants.status });
}

/** A board with no work on it demos nothing, so one task per open stage. */
async function createTasks(
  owner: Owner,
  created: readonly { readonly id: string; readonly status: string }[],
): Promise<number> {
  const byStatus = (status: string): string | undefined =>
    created.find((row) => row.status === status)?.id;
  const wanted = [
    { status: "called", title: "Lead erneut anrufen", due: 1 },
    { status: "not_reachable", title: "Zweitkontakt per E-Mail versuchen", due: -2 },
    { status: "eligibility_unclear", title: "Verfügbarkeit klären (20h/Woche)", due: 0 },
    { status: "employer_pending", title: "Arbeitgeber zur Freistellung nachfassen", due: -1 },
    { status: "test_phase", title: "Ergebnis des Eignungstests prüfen", due: 3 },
    { status: "documents_phase", title: "Unterlagen auf Vollständigkeit prüfen", due: 2 },
  ];
  const values = wanted.flatMap((entry) => {
    const participantId = byStatus(entry.status);
    if (!participantId) return [];
    return [
      {
        tenantId: owner.tenantId,
        type: entry.status,
        title: entry.title,
        status: "open" as const,
        // `tasks_owner_matches_kind` allows exactly one owner column per kind:
        // an internally owned task names the user, and the participant it is
        // about travels in subject_kind/subject_id instead.
        ownerKind: "internal_user" as const,
        ownerUserId: owner.id,
        channel: "internal" as const,
        subjectKind: "participant" as const,
        subjectId: participantId,
        dueAt: daysFromNow(entry.due),
      },
    ];
  });
  if (values.length === 0) return 0;
  await db.insert(tasks).values(values);
  return values.length;
}

async function createAppointments(
  owner: Owner,
  created: readonly { readonly id: string; readonly status: string }[],
): Promise<number> {
  const wanted = [
    { status: "interested", type: "consultation" as const, inDays: 2 },
    { status: "qualified", type: "aptitude_test" as const, inDays: 5 },
  ];
  const values = wanted.flatMap((entry) => {
    const row = created.find((candidate) => candidate.status === entry.status);
    if (!row) return [];
    return [
      {
        tenantId: owner.tenantId,
        participantId: row.id,
        consultantId: owner.id,
        type: entry.type,
        status: "scheduled" as const,
        scheduledAt: daysFromNow(entry.inDays),
      },
    ];
  });
  if (values.length === 0) return 0;
  await db.insert(appointments).values(values);
  return values.length;
}

async function main(): Promise<void> {
  const owner = await findOwner();
  if (process.argv.includes("--remove")) {
    await removeDemoData(owner);
    return;
  }
  const existing = await findDemoParticipantIds(owner.tenantId);
  if (existing.length > 0) {
    console.log(
      `demo data already present (${existing.length} participants) — skipped`,
    );
    return;
  }
  const measureId = await ensureMeasure(owner.tenantId);
  const employerIds = await createEmployers(owner.tenantId);
  const created = await createParticipants(owner, measureId, employerIds);
  const taskCount = await createTasks(owner, created);
  const appointmentCount = await createAppointments(owner, created);
  console.log(`measure "${MEASURE_NAME}" ready`);
  console.log(`${employerIds.length} employers created`);
  console.log(`${created.length} participants created, assigned to ${ownerEmail}`);
  console.log(`${taskCount} tasks created`);
  console.log(`${appointmentCount} appointments created`);
}

// Not top-level await: tsx transpiles a plain .ts script to CJS, which rejects it.
main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => client.end());
