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
  magicLinkTokens,
  measures,
  messageTemplates,
  participants,
  reminderJobs,
  routingRules,
  signatures,
  tasks,
  tenants,
  users,
} from "./schema";
import { issueMagicLink } from "@/modules/tokens/service";

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
  await db.delete(users);
  await db.delete(tenants);

  const [tenant] = await db
    .insert(tenants)
    .values({ name: "Demo Bildungsträger GmbH" })
    .returning();
  const tenantId = tenant.id;

  const passwordHash = await hash("demo1234", 10);
  const [, consultant] = await db
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
  const participantRows = await db
    .insert(participants)
    .values([
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
    ])
    .returning();

  const lena = participantRows[0];
  const deniz = participantRows[3];
  const sofia = participantRows[4];
  const ole = participantRows[9];

  // --- Routing rules: the spec's task-routing matrix as data ---------------
  await db.insert(routingRules).values([
    {
      tenantId,
      name: "Falsche Telefonnummer → Teilnehmer per E-Mail",
      triggerEntity: "participant" as const,
      triggerStatus: "wrong_number",
      taskType: "request_correct_contact",
      titleTemplate: "Korrekte Kontaktdaten angeben",
      ownerKind: "participant" as const,
      channel: "email" as const,
      dueHours: 72,
      escalationHours: 120,
    },
    {
      tenantId,
      name: "Nicht erreichbar → interne Anruf-Aufgabe",
      triggerEntity: "participant" as const,
      triggerStatus: "not_reachable",
      taskType: "retry_call",
      titleTemplate: "Lead erneut anrufen",
      ownerKind: "internal_user" as const,
      channel: "internal" as const,
      dueHours: 24,
    },
    {
      tenantId,
      name: "Nicht erreichbar → Teilnehmer per WhatsApp/E-Mail",
      triggerEntity: "participant" as const,
      triggerStatus: "not_reachable",
      taskType: "confirm_reachability",
      titleTemplate: "Rückmeldung zur Erreichbarkeit geben",
      ownerKind: "participant" as const,
      channel: "whatsapp" as const,
      dueHours: 48,
    },
    {
      tenantId,
      name: "Termin geplant → Erinnerungen",
      triggerEntity: "appointment" as const,
      triggerStatus: "scheduled",
      taskType: "appointment_reminder",
      titleTemplate: "Terminerinnerung",
      ownerKind: "participant" as const,
      channel: "whatsapp" as const,
      reminderPlan: [
        { beforeHours: 24, channel: "whatsapp", templateKey: "appointment_reminder_24h" },
        { beforeHours: 2, channel: "whatsapp", templateKey: "appointment_reminder_2h" },
        { beforeHours: 1, channel: "internal", templateKey: "reminder_call" },
      ],
    },
    {
      tenantId,
      name: "Eignungstest offen → Teilnehmer-Link",
      triggerEntity: "aptitude_test" as const,
      triggerStatus: "invited",
      taskType: "start_aptitude_test",
      titleTemplate: "Eignungstest starten",
      ownerKind: "participant" as const,
      channel: "magic_link" as const,
      dueHours: 48,
      reminderPlan: [
        { afterHours: 24, channel: "whatsapp", templateKey: "test_reminder_24h" },
        { afterHours: 48, channel: "email", templateKey: "test_reminder_48h" },
      ],
      escalationHours: 72,
    },
    {
      tenantId,
      name: "Betriebsnummer fehlt → Arbeitgeber-Link",
      triggerEntity: "employer" as const,
      triggerStatus: "betriebsnummer_missing",
      taskType: "provide_betriebsnummer",
      titleTemplate: "Betriebsnummer angeben",
      ownerKind: "employer" as const,
      channel: "magic_link" as const,
      dueHours: 48,
      escalationHours: 120,
    },
    {
      tenantId,
      name: "AG-S-Status unklar → Arbeitgeber-Link",
      triggerEntity: "employer" as const,
      triggerStatus: "ags_unclear",
      taskType: "confirm_ags_status",
      titleTemplate: "Status beim Arbeitgeberservice bestätigen",
      ownerKind: "employer" as const,
      channel: "magic_link" as const,
      dueHours: 48,
      escalationHours: 120,
    },
    {
      tenantId,
      name: "20h/Woche unbestätigt → Arbeitgeber-Link",
      triggerEntity: "participant" as const,
      triggerStatus: "availability_probably_employer_pending",
      taskType: "confirm_time_model",
      titleTemplate: "Zeitmodell 20h/Woche bestätigen",
      ownerKind: "employer" as const,
      channel: "magic_link" as const,
      dueHours: 72,
      escalationHours: 120,
    },
    {
      tenantId,
      name: "Verfügbarkeit teilweise → Beratung klären",
      triggerEntity: "participant" as const,
      triggerStatus: "availability_partial",
      taskType: "clarify_availability",
      titleTemplate: "Verfügbarkeit und Freigabe klären",
      ownerKind: "internal_user" as const,
      channel: "internal" as const,
      dueHours: 48,
    },
    {
      tenantId,
      name: "Verfügbarkeit unklar → Beratung klären",
      triggerEntity: "participant" as const,
      triggerStatus: "availability_unclear",
      taskType: "clarify_availability",
      titleTemplate: "Verfügbarkeit und Freigabe klären",
      ownerKind: "internal_user" as const,
      channel: "internal" as const,
      dueHours: 48,
    },
    {
      tenantId,
      name: "Verfügbarkeit nicht möglich → Beratungsgespräch",
      triggerEntity: "participant" as const,
      triggerStatus: "availability_not_possible",
      taskType: "consult_alternatives",
      titleTemplate: "Alternativen besprechen (20h/Woche nicht möglich)",
      ownerKind: "internal_user" as const,
      channel: "internal" as const,
      dueHours: 72,
    },
    {
      tenantId,
      name: "Dokumentdaten fehlen → zuständige Person",
      triggerEntity: "document" as const,
      triggerStatus: "data_missing",
      taskType: "complete_document_data",
      titleTemplate: "Fehlende Dokumentdaten ergänzen",
      ownerKind: "internal_user" as const,
      channel: "internal" as const,
      dueHours: 48,
    },
    // Two signature rules — the requestSignature action puts only the actual
    // signer into the transition context, so exactly one of them matches.
    {
      tenantId,
      name: "Signatur fehlt → Unterzeichner-Link (Teilnehmer)",
      triggerEntity: "signature" as const,
      triggerStatus: "pending",
      taskType: "sign_document",
      titleTemplate: "Dokument unterschreiben",
      ownerKind: "participant" as const,
      channel: "magic_link" as const,
      dueHours: 72,
      reminderPlan: [
        { afterHours: 24, channel: "whatsapp", templateKey: "signature_reminder_24h" },
        { afterHours: 72, channel: "email", templateKey: "signature_reminder_72h" },
      ],
      escalationHours: 96,
    },
    {
      tenantId,
      name: "Signatur fehlt → Unterzeichner-Link (Arbeitgeber)",
      triggerEntity: "signature" as const,
      triggerStatus: "pending",
      taskType: "sign_document",
      titleTemplate: "Dokument unterschreiben",
      ownerKind: "employer" as const,
      channel: "magic_link" as const,
      dueHours: 72,
      reminderPlan: [
        { afterHours: 24, channel: "email", templateKey: "signature_reminder_24h" },
        { afterHours: 72, channel: "email", templateKey: "signature_reminder_72h" },
      ],
      escalationHours: 96,
    },
    {
      tenantId,
      name: "Kontaktdaten aktualisiert → erneut anrufen",
      triggerEntity: "participant" as const,
      triggerStatus: "contact_updated",
      taskType: "retry_call",
      titleTemplate: "Lead erneut anrufen (Kontaktdaten aktualisiert)",
      ownerKind: "internal_user" as const,
      channel: "internal" as const,
      dueHours: 24,
    },
    {
      tenantId,
      name: "Termin No-Show → nachfassen + neuen Termin anbieten",
      triggerEntity: "appointment" as const,
      triggerStatus: "no_show",
      taskType: "reschedule_after_no_show",
      titleTemplate: "Neuen Termin vereinbaren",
      ownerKind: "participant" as const,
      channel: "whatsapp" as const,
      dueHours: 48,
      escalationHours: 96,
    },
    {
      tenantId,
      name: "Termin No-Show → interne Nachverfolgung",
      triggerEntity: "appointment" as const,
      triggerStatus: "no_show",
      taskType: "follow_up_no_show",
      titleTemplate: "No-Show nachfassen (Anruf)",
      ownerKind: "internal_user" as const,
      channel: "internal" as const,
      dueHours: 24,
    },
    {
      tenantId,
      name: "Eignungstest bestanden → Dokumente vorbereiten",
      triggerEntity: "aptitude_test" as const,
      triggerStatus: "passed",
      taskType: "prepare_documents",
      titleTemplate: "Antragsunterlagen vorbereiten",
      ownerKind: "internal_user" as const,
      channel: "internal" as const,
      dueHours: 48,
    },
    {
      tenantId,
      name: "Eignungstest nicht bestanden → Beratung",
      triggerEntity: "aptitude_test" as const,
      triggerStatus: "failed",
      taskType: "consult_alternatives",
      titleTemplate: "Beratungsgespräch: Alternativen empfehlen",
      ownerKind: "internal_user" as const,
      channel: "internal" as const,
      dueHours: 48,
    },
    {
      tenantId,
      name: "Eignungstest No-Show → neuen Termin anbieten",
      triggerEntity: "aptitude_test" as const,
      triggerStatus: "no_show",
      taskType: "reschedule_after_no_show",
      titleTemplate: "Neuen Testtermin vereinbaren",
      ownerKind: "participant" as const,
      channel: "whatsapp" as const,
      dueHours: 48,
      escalationHours: 96,
    },
    {
      tenantId,
      name: "Antragspaket bereit → Verwaltung",
      triggerEntity: "application" as const,
      triggerStatus: "complete",
      taskType: "review_application_package",
      titleTemplate: "Antragspaket prüfen und freigeben",
      ownerKind: "internal_user" as const,
      channel: "internal" as const,
      dueHours: 24,
    },
    {
      tenantId,
      name: "Einreichung offen → Arbeitgeber",
      triggerEntity: "application" as const,
      triggerStatus: "sent_to_employer",
      taskType: "confirm_submission",
      titleTemplate: "Einreichung beim Arbeitgeberservice bestätigen",
      ownerKind: "employer" as const,
      channel: "magic_link" as const,
      dueHours: 96,
      escalationHours: 168,
    },
    {
      tenantId,
      name: "Eingereicht → Beratung verfolgt Rückmeldung",
      triggerEntity: "application" as const,
      triggerStatus: "submitted",
      taskType: "track_ba_response",
      titleTemplate: "Rückmeldung der Agentur für Arbeit verfolgen",
      ownerKind: "internal_user" as const,
      channel: "internal" as const,
      dueHours: 24 * 10,
      escalationHours: 24 * 21,
    },
    {
      tenantId,
      name: "Antwort ausstehend → Verwaltung Follow-up",
      triggerEntity: "application" as const,
      triggerStatus: "response_pending",
      taskType: "follow_up_ba",
      titleTemplate: "Bei der Agentur für Arbeit nachfassen",
      ownerKind: "internal_user" as const,
      channel: "internal" as const,
      dueHours: 24 * 7,
      escalationHours: 24 * 14,
    },
    {
      tenantId,
      name: "Korrektur erforderlich → Beratung",
      triggerEntity: "application" as const,
      triggerStatus: "correction_required",
      taskType: "correct_application",
      titleTemplate: "Antrag korrigieren und erneut einreichen",
      ownerKind: "internal_user" as const,
      channel: "internal" as const,
      dueHours: 24 * 5,
    },
  ]);

  // --- Message templates (placeholder German copy; final texts from client)
  await db.insert(messageTemplates).values([
    {
      tenantId,
      key: "wrong_number_email",
      channel: "email" as const,
      subject: "Ihre Kontaktdaten für die geförderte Weiterbildung",
      body: "Hallo {{firstName}}, wir konnten Sie telefonisch nicht erreichen. Bitte aktualisieren Sie Ihre Kontaktdaten über diesen Link: {{link}} (PLATZHALTER — finaler Text folgt)",
    },
    {
      tenantId,
      key: "appointment_reminder_24h",
      channel: "whatsapp" as const,
      body: "Hallo {{firstName}}, morgen um {{time}} findet Ihr Beratungstermin statt. Bei Verhinderung können Sie hier umbuchen: {{link}} (PLATZHALTER)",
    },
    {
      tenantId,
      key: "test_reminder_24h",
      channel: "whatsapp" as const,
      body: "Hallo {{firstName}}, Ihr Eignungstest wartet auf Sie (ca. 30 Minuten): {{link}} (PLATZHALTER)",
    },
    {
      tenantId,
      key: "availability_check",
      channel: "whatsapp" as const,
      body: "Hallo {{firstName}}, bitte bestätigen Sie kurz Ihre Verfügbarkeit für die Weiterbildung (dauert 2 Minuten): {{link}} (PLATZHALTER)",
    },
  ]);

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
