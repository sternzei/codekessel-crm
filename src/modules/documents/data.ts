import { and, desc, eq } from "drizzle-orm";
import type { DbHandle } from "@/db/client";
import {
  applications,
  consentRecords,
  documents,
  employers,
  measures,
  participants,
  signatures,
} from "@/db/schema";

// Central data collection (concept §9): everything the application
// documents need, assembled once. Every generator and the checklist
// read from this single structure.

export type ApplicationData = NonNullable<
  Awaited<ReturnType<typeof collectApplicationData>>
>;

export async function collectApplicationData(
  tx: DbHandle,
  participantId: string,
) {
  const [participant] = await tx
    .select()
    .from(participants)
    .where(eq(participants.id, participantId));
  if (!participant) return null;

  const [employer] = participant.employerId
    ? await tx
        .select()
        .from(employers)
        .where(eq(employers.id, participant.employerId))
    : [];
  const [measure] = participant.measureId
    ? await tx
        .select()
        .from(measures)
        .where(eq(measures.id, participant.measureId))
    : [];

  const docs = await tx
    .select()
    .from(documents)
    .where(eq(documents.participantId, participantId))
    .orderBy(desc(documents.createdAt));

  const docIds = docs.map((d) => d.id);
  const sigs = docIds.length
    ? await tx
        .select()
        .from(signatures)
        .where(eq(signatures.documentId, docIds[0]))
    : [];
  // Load signatures for all docs (small N in MVP).
  const allSigs =
    docIds.length > 1
      ? await Promise.all(
          docs.map((d) =>
            tx.select().from(signatures).where(eq(signatures.documentId, d.id)),
          ),
        ).then((r) => r.flat())
      : sigs;

  const consents = await tx
    .select()
    .from(consentRecords)
    .where(eq(consentRecords.participantId, participantId));

  // The single in-progress application for this participant (if any). The
  // checklist page uses its presence to switch between "create" and "open".
  const [application] = await tx
    .select()
    .from(applications)
    .where(eq(applications.participantId, participantId));

  return {
    participant,
    employer: employer ?? null,
    measure: measure ?? null,
    documents: docs,
    signatures: allSigs,
    consents,
    application: application ?? null,
  };
}

/**
 * Company-applicant cohort: every participant of the same employer + measure.
 * Feeds the Sammelantrag-Teilnehmerliste (one list per employer + measure,
 * max 18 rows per form).
 */
export async function collectCompanyCohort(
  tx: DbHandle,
  employerId: string,
  measureId: string,
) {
  return tx
    .select({
      firstName: participants.firstName,
      lastName: participants.lastName,
      dateOfBirth: participants.dateOfBirth,
    })
    .from(participants)
    .where(
      and(
        eq(participants.employerId, employerId),
        eq(participants.measureId, measureId),
      ),
    )
    .orderBy(participants.lastName);
}

// ---------------------------------------------------------------------------
// Document checklist (concept §10)
// ---------------------------------------------------------------------------

export type ChecklistState = "ok" | "warn" | "missing";
export type ChecklistItem = { label: string; state: ChecklistState; hint?: string };

export function buildChecklist(data: ApplicationData): ChecklistItem[] {
  const p = data.participant;
  const e = data.employer;
  const m = data.measure;

  const participantComplete = Boolean(
    p.firstName && p.lastName && p.dateOfBirth && p.phone && p.email &&
      p.street && p.postalCode && p.city,
  );
  const employerComplete = Boolean(
    e && e.companyName && e.contactName && e.contactEmail,
  );
  const generated = data.documents.filter((d) => d.type !== "participant_upload");
  const signaturesComplete =
    data.signatures.length > 0 &&
    data.signatures.every((s) => s.status === "signed");
  const hasConsent = data.consents.some(
    (c) => c.kind === "privacy_policy" && c.granted,
  );

  return [
    {
      label: "Teilnehmerdaten vollständig",
      state: participantComplete ? "ok" : "warn",
      hint: participantComplete
        ? undefined
        : "Geburtsdatum, Adresse oder Kontaktdaten fehlen",
    },
    {
      label: "Einwilligungen (Datenschutz) vorhanden",
      state: hasConsent ? "ok" : "missing",
    },
    {
      label: "Arbeitgeberdaten vollständig",
      state: employerComplete ? "ok" : e ? "warn" : "missing",
      hint: e ? undefined : "Kein Arbeitgeber verknüpft",
    },
    {
      label: "Betriebsnummer vorhanden",
      state: e?.betriebsnummer ? "ok" : "missing",
    },
    {
      label: "Arbeitgeberservice-Status bestätigt",
      state:
        e?.agsRegistered === true
          ? "ok"
          : e?.agsRegistered === false
            ? "warn"
            : "missing",
      hint: e?.agsRegistered === false ? "Registrierung noch erforderlich" : undefined,
    },
    {
      label: "Zeitmodell 20 Std./Woche bestätigt (Arbeitgeber)",
      state: e?.timeModelStatus === "yes" ? "ok" : "missing",
    },
    {
      label: "Verfügbarkeit bestätigt (Teilnehmer:in)",
      state: p.availabilityStatus === "yes" ? "ok" : "missing",
    },
    {
      label: "Maßnahmedaten vollständig",
      state: m && m.azavNumber && m.startDate && m.costEur ? "ok" : m ? "warn" : "missing",
      hint: m ? undefined : "Keine Maßnahme zugeordnet",
    },
    {
      label: "Dokumente erstellt",
      state: generated.length >= 2 ? "ok" : generated.length > 0 ? "warn" : "missing",
    },
    {
      label: "Erforderliche Signaturen vollständig",
      state: signaturesComplete
        ? "ok"
        : data.signatures.length > 0
          ? "warn"
          : "missing",
    },
  ];
}
