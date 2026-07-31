/**
 * Demo seed: makes all three portals clickable after every phase.
 * Runs as the table OWNER (MIGRATION_DATABASE_URL) — RLS bypass is intended
 * here and only here. Idempotent: wipes and re-creates all demo data.
 *
 * Run: pnpm db:seed
 */
import { hash } from "bcryptjs";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  activityLog,
  appointments,
  applications,
  aptitudeTests,
  consentRecords,
  contactNotes,
  documents,
  employers,
  importRuns,
  magicLinkTokens,
  measures,
  messageDeliveries,
  messageTemplates,
  outboundMessages,
  participants,
  reminderJobs,
  routingRules,
  signatures,
  tasks,
  tenants,
  users,
} from "./schema";
import { issueMagicLink } from "@/modules/tokens/service";
import { buildTemplateRows } from "@/modules/messaging/catalog";
import { buildDefaultRoutingRules } from "@/modules/routing/default-rules";
import { normalizePhone } from "@/modules/participants/phone";

const url = process.env.MIGRATION_DATABASE_URL;
if (!url) throw new Error("MIGRATION_DATABASE_URL is not set");

import * as schema from "./schema";
import { resolveAptitudeTestUrl } from "@/modules/aptitude-tests/config";

const sql = postgres(url, { max: 1 });
const db = drizzle(sql, { schema });

async function main() {
  // Wipe in FK-safe order (children before parents).
  await db.delete(activityLog);
  await db.delete(consentRecords);
  await db.delete(contactNotes);
  await db.delete(reminderJobs);
  await db.delete(magicLinkTokens);
  await db.delete(messageDeliveries);
  await db.delete(outboundMessages);
  await db.delete(signatures);
  await db.delete(documents);
  await db.delete(applications);
  await db.delete(tasks);
  await db.delete(aptitudeTests);
  await db.delete(appointments);
  await db.delete(participants);
  await db.delete(routingRules);
  await db.delete(messageTemplates);
  await db.delete(measures);
  await db.delete(employers);
  await db.delete(importRuns);
  await db.delete(users);
  await db.delete(tenants);

  const [tenant] = await db
    .insert(tenants)
    .values({ name: "Demo Bildungsträger GmbH" })
    .returning();
  const tenantId = tenant.id;

  const passwordHash = await hash("demo1234", 10);
  const [, , consultant] = await db
    .insert(users)
    .values([
      {
        tenantId,
        email: "admin@demo.de",
        name: "Anna Adler",
        role: "admin" as const,
        passwordHash,
      },
      {
        tenantId,
        email: "leitung@demo.de",
        name: "Mara Manager",
        role: "manager" as const,
        passwordHash,
      },
      {
        tenantId,
        email: "berater@demo.de",
        name: "Max Berger",
        role: "consultant" as const,
        passwordHash,
      },
    ])
    .returning();

  const [measureData, measureCare] = await db
    .insert(measures)
    .values([
      {
        tenantId,
        name: "Digitale Kompetenzen im Beruf (PLATZHALTER)",
        azavNumber: "AZAV-2026-0001-DEMO",
        durationWeeks: 26,
        weeklyHours: 20,
        format: "online" as const,
        costEur: "8900.00",
        startDate: "2026-09-01",
        targetGroup: "Beschäftigte in KMU",
        objective: "Aufbau digitaler Grundkompetenzen (Platzhaltertext)",
      },
      {
        tenantId,
        name: "Fachkraft Pflegeassistenz (PLATZHALTER)",
        azavNumber: "AZAV-2026-0002-DEMO",
        durationWeeks: 26,
        weeklyHours: 20,
        format: "hybrid" as const,
        costEur: "11400.00",
        startDate: "2026-10-01",
        targetGroup: "Beschäftigte in der Pflegebranche",
        objective: "Qualifizierung zur Pflegeassistenz (Platzhaltertext)",
      },
    ])
    .returning();

  const [nordbau, pflegeplus, cityLogistik, buerotec] = await db
    .insert(employers)
    .values([
      {
        tenantId,
        status: "confirmed" as const,
        companyName: "Nordbau GmbH",
        street: "Hafenstraße 12",
        postalCode: "20457",
        city: "Hamburg",
        industry: "Bauwesen",
        employeeCount: 85,
        contactName: "Petra Schmidt",
        contactRole: "Personalleitung",
        contactEmail: "p.schmidt@nordbau-demo.de",
        contactPhone: "+49 40 1234567",
        betriebsnummer: "12345678",
        responsibleAgency: "Agentur für Arbeit Hamburg",
        agsRegistered: true,
        trainingSupportConfirmed: true,
        timeModelStatus: "yes" as const,
      },
      {
        tenantId,
        status: "betriebsnummer_missing" as const,
        companyName: "PflegePlus Sozialdienste eG",
        city: "Bremen",
        industry: "Pflege",
        employeeCount: 42,
        contactName: "Jörg Weber",
        contactRole: "Geschäftsführung",
        contactEmail: "weber@pflegeplus-demo.de",
        timeModelStatus: "probably_employer_pending" as const,
      },
      {
        tenantId,
        status: "time_model_pending" as const,
        companyName: "City Logistik KG",
        city: "Hannover",
        industry: "Logistik",
        employeeCount: 120,
        contactName: "Sina Krause",
        contactRole: "HR Business Partner",
        contactEmail: "krause@citylogistik-demo.de",
        betriebsnummer: "87654321",
        agsRegistered: false,
        timeModelStatus: "unclear" as const,
      },
      {
        tenantId,
        status: "invited" as const,
        companyName: "BüroTec Service GmbH",
        city: "Kiel",
        industry: "Facility Management",
        employeeCount: 18,
        timeModelStatus: "unclear" as const,
      },
    ])
    .returning();

  // Leads/participants spread across the pipeline.
  const participantSeeds = [
      {
        tenantId,
        status: "new" as const,
        firstName: "Lena",
        lastName: "Hoffmann",
        email: "lena.hoffmann@example.de",
        phone: "+49 151 1111111",
        dateOfBirth: "1993-04-17",
        street: "Alsterweg 5",
        postalCode: "20095",
        city: "Hamburg",
        employmentStatus: "employed" as const,
        employerId: nordbau.id,
        measureId: measureData.id,
        assignedConsultantId: consultant.id,
        source: "Meta Ads",
      },
      {
        tenantId,
        status: "new" as const,
        firstName: "Tarek",
        lastName: "Aziz",
        phone: "+49 151 2222222",
        city: "Bremen",
        employmentStatus: "employed" as const,
        assignedConsultantId: consultant.id,
        source: "Website",
      },
      {
        tenantId,
        status: "called" as const,
        firstName: "Marta",
        lastName: "Kowalska",
        email: "marta.k@example.de",
        phone: "+49 151 3333333",
        city: "Hannover",
        employmentStatus: "employed" as const,
        employerId: cityLogistik.id,
        measureId: measureData.id,
        assignedConsultantId: consultant.id,
        availabilityStatus: "probably_employer_pending" as const,
        source: "Empfehlung",
      },
      {
        tenantId,
        status: "not_reachable" as const,
        firstName: "Deniz",
        lastName: "Yilmaz",
        phone: "+49 151 4444444",
        city: "Kiel",
        assignedConsultantId: consultant.id,
        source: "Meta Ads",
      },
      {
        tenantId,
        status: "wrong_number" as const,
        firstName: "Sofia",
        lastName: "Ricci",
        email: "sofia.ricci@example.de",
        city: "Hamburg",
        assignedConsultantId: consultant.id,
        source: "Meta Ads",
      },
      {
        tenantId,
        status: "interested" as const,
        firstName: "Jonas",
        lastName: "Petersen",
        email: "jonas.p@example.de",
        phone: "+49 151 5555555",
        city: "Bremen",
        employmentStatus: "employed" as const,
        employerId: pflegeplus.id,
        measureId: measureCare.id,
        assignedConsultantId: consultant.id,
        availabilityStatus: "unclear" as const,
        source: "Website",
      },
      {
        tenantId,
        status: "eligibility_unclear" as const,
        firstName: "Aylin",
        lastName: "Demir",
        phone: "+49 151 6666666",
        city: "Hannover",
        employmentStatus: "self_employed" as const,
        assignedConsultantId: consultant.id,
        eligibilityNotes: "Selbstständig — QCG-Förderfähigkeit prüfen",
        source: "Empfehlung",
      },
      {
        tenantId,
        status: "employer_pending" as const,
        firstName: "Viktor",
        lastName: "Brandt",
        email: "v.brandt@example.de",
        phone: "+49 151 7777777",
        city: "Kiel",
        employmentStatus: "employed" as const,
        employerId: buerotec.id,
        measureId: measureData.id,
        assignedConsultantId: consultant.id,
        availabilityStatus: "probably_employer_pending" as const,
        source: "Website",
      },
      {
        tenantId,
        status: "qualified" as const,
        firstName: "Fatima",
        lastName: "El-Sayed",
        email: "fatima.es@example.de",
        phone: "+49 151 8888888",
        city: "Hamburg",
        employmentStatus: "employed" as const,
        employerId: nordbau.id,
        measureId: measureData.id,
        assignedConsultantId: consultant.id,
        availabilityStatus: "yes" as const,
        source: "Empfehlung",
      },
      {
        tenantId,
        status: "test_phase" as const,
        firstName: "Ole",
        lastName: "Janssen",
        email: "ole.j@example.de",
        phone: "+49 151 9999999",
        city: "Bremen",
        employmentStatus: "employed" as const,
        employerId: pflegeplus.id,
        measureId: measureCare.id,
        assignedConsultantId: consultant.id,
        availabilityStatus: "yes" as const,
        source: "Meta Ads",
      },
  ];

  // phone_normalized drives dedup on import and the phone-coverage KPI, so the
  // seed has to fill it the same way the app does.
  const participantRows = await db
    .insert(participants)
    .values(
      participantSeeds.map((seed) => ({
        ...seed,
        phoneNormalized: normalizePhone({ raw: seed.phone }).normalized,
      })),
    )
    .returning();

  const lena = participantRows[0];
  const deniz = participantRows[3];
  const sofia = participantRows[4];
  const ole = participantRows[9];

  // --- Routing rules: the spec's task-routing matrix as data ---------------
  await db.insert(routingRules).values([...buildDefaultRoutingRules(tenantId)]);

  // --- Message templates ----------------------------------------------------
  // Written from the catalog so every key the app can request has an active row
  // per channel. Rendering throws on a miss, so this is not optional demo data.
  await db
    .insert(messageTemplates)
    .values(buildTemplateRows().map((row) => ({ ...row, tenantId })));

  // --- Demo appointments + contact notes -----------------------------------
  const marta = participantRows[2];
  await db.insert(appointments).values([
    {
      tenantId,
      participantId: marta.id,
      consultantId: consultant.id,
      type: "follow_up" as const,
      status: "scheduled" as const,
      scheduledAt: hoursFromNow(26),
      notes: "Zweitgespräch: Arbeitgeber-Freigabe klären",
    },
    {
      tenantId,
      participantId: deniz.id,
      consultantId: consultant.id,
      type: "follow_up" as const,
      status: "no_show" as const,
      scheduledAt: hoursFromNow(-48),
    },
  ]);

  await db.insert(contactNotes).values([
    {
      tenantId,
      participantId: marta.id,
      authorUserId: consultant.id,
      channel: "internal" as const,
      body: "Erstgespräch geführt: sehr interessiert, Arbeitgeber (City Logistik) muss Freistellung intern klären. Folgetermin vereinbart.",
    },
    {
      tenantId,
      participantId: deniz.id,
      authorUserId: consultant.id,
      channel: "whatsapp" as const,
      body: "Zweimal nicht erreicht, WhatsApp-Nachricht gesendet. Bei erneutem Fehlversuch auf inaktiv setzen.",
    },
  ]);

  // --- Open tasks so the dashboard is alive --------------------------------
  const [oleTest] = await db
    .insert(aptitudeTests)
    .values({
      tenantId,
      participantId: ole.id,
      status: "invited" as const,
      invitedAt: new Date(),
      testUrl: resolveAptitudeTestUrl(ole.id),
    })
    .returning();

  const [callTask, sofiaContactTask, betriebsnummerTask, oleTestTask] = await db
    .insert(tasks)
    .values([
      {
        tenantId,
        type: "retry_call",
        title: "Lead erneut anrufen",
        description: "Deniz Yilmaz war zweimal nicht erreichbar.",
        status: "open" as const,
        ownerKind: "internal_user" as const,
        ownerUserId: consultant.id,
        channel: "internal" as const,
        subjectKind: "participant" as const,
        subjectId: deniz.id,
        dueAt: hoursFromNow(24),
      },
      {
        tenantId,
        type: "request_correct_contact",
        title: "Korrekte Kontaktdaten angeben",
        status: "open" as const,
        ownerKind: "participant" as const,
        ownerParticipantId: sofia.id,
        channel: "email" as const,
        subjectKind: "participant" as const,
        subjectId: sofia.id,
        dueAt: hoursFromNow(72),
      },
      {
        tenantId,
        type: "provide_betriebsnummer",
        title: "Betriebsnummer angeben",
        status: "open" as const,
        ownerKind: "employer" as const,
        ownerEmployerId: pflegeplus.id,
        channel: "magic_link" as const,
        subjectKind: "employer" as const,
        subjectId: pflegeplus.id,
        dueAt: hoursFromNow(48),
        escalationAt: hoursFromNow(120),
      },
      {
        tenantId,
        type: "start_aptitude_test",
        title: "Eignungstest starten",
        status: "open" as const,
        ownerKind: "participant" as const,
        ownerParticipantId: ole.id,
        channel: "magic_link" as const,
        subjectKind: "aptitude_test" as const,
        subjectId: oleTest.id,
        dueAt: hoursFromNow(48),
      },
    ])
    .returning();

  // --- The demo magic link: Lena confirms her 20h/6-month availability -----
  const [availabilityTask] = await db
    .insert(tasks)
    .values({
      tenantId,
      type: "confirm_availability",
      title: "Verfügbarkeit bestätigen (20h/Woche über 6 Monate)",
      status: "open" as const,
      ownerKind: "participant" as const,
      ownerParticipantId: lena.id,
      channel: "magic_link" as const,
      subjectKind: "participant" as const,
      subjectId: lena.id,
      dueAt: hoursFromNow(72),
    })
    .returning();

  const magicLink = await issueMagicLink(db, {
    tenantId,
    taskId: availabilityTask.id,
    subjectKind: "participant",
    subjectId: lena.id,
    scope: "confirm_availability",
  });

  const sofiaLink = await issueMagicLink(db, {
    tenantId,
    taskId: sofiaContactTask.id,
    subjectKind: "participant",
    subjectId: sofia.id,
    scope: "request_correct_contact",
  });
  const employerLink = await issueMagicLink(db, {
    tenantId,
    taskId: betriebsnummerTask.id,
    subjectKind: "employer",
    subjectId: pflegeplus.id,
    scope: "provide_betriebsnummer",
  });
  const oleLink = await issueMagicLink(db, {
    tenantId,
    taskId: oleTestTask.id,
    subjectKind: "participant",
    subjectId: ole.id,
    scope: "start_aptitude_test",
  });

  // Sample consent + activity so audit surfaces aren't empty.
  await db.insert(consentRecords).values({
    tenantId,
    participantId: lena.id,
    kind: "contact_consent" as const,
    granted: true,
    textVersion: "v0.1-placeholder",
    ipAddress: "203.0.113.10",
  });
  await db.insert(activityLog).values([
    {
      tenantId,
      actorKind: "internal_user" as const,
      actorUserId: consultant.id,
      subjectKind: "participant" as const,
      subjectId: deniz.id,
      event: "status_changed",
      meta: { status: "not_reachable" },
    },
    {
      tenantId,
      actorKind: "system" as const,
      subjectKind: "task" as const,
      subjectId: callTask.id,
      event: "task_created",
      meta: { taskType: "retry_call" },
    },
  ]);

  console.log("Seed complete.\n");
  console.log("── Internal sign-in ──────────────────────────────────────");
  console.log("   Admin:      admin@demo.de   / demo1234");
  console.log("   Consultant: berater@demo.de / demo1234");
  console.log("\n── Demo magic links (open in a private window) ──────────");
  console.log(`   Verfügbarkeit (Lena Hoffmann):\n   ${magicLink.url}`);
  console.log(`   Kontaktdaten korrigieren (Sofia Ricci):\n   ${sofiaLink.url}`);
  console.log(`   Arbeitgeber-Setup (PflegePlus):\n   ${employerLink.url}`);
  console.log(`   Eignungstest starten (Ole Janssen):\n   ${oleLink.url}`);
}

function hoursFromNow(hours: number): Date {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

main()
  .then(() => sql.end())
  .catch((error) => {
    console.error(error);
    return sql.end().then(() => process.exit(1));
  });
