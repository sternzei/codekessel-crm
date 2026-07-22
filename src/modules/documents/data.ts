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
import { findMissingSignatures } from "@/modules/signatures/requirements";
import {
  evaluateUploadSet,
  resolveApplicantType,
} from "@/modules/applications/upload-set";

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
      // Epic A: the SV number is now captured centrally, so the cohort list can
      // fill it in (previously always blank).
      svNumber: participants.svNumber,
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

// Severity of a readiness requirement:
// - "blocker": must be satisfied before an application may be completed/submitted.
// - "warning": surfaced to the consultant but does not block the transition.
export type ReadinessSeverity = "blocker" | "warning";

// One shared readiness requirement. `satisfied` drives the server-side gate
// (blocker severity), while `state` is the richer tri-state used by the UI
// checklist. Both are derived from the SAME predicate so the rule lives once.
export type ReadinessCheck = {
  code: string;
  label: string;
  severity: ReadinessSeverity;
  satisfied: boolean;
  state: ChecklistState;
  hint?: string;
};

export type ApplicationReadiness = {
  ready: boolean;
  checks: ReadinessCheck[];
  blockers: ReadinessCheck[];
  warnings: ReadinessCheck[];
};

/**
 * The single source of submission-readiness truth (concept §10/§14). Both the
 * server transition to `complete`/`submitted` and the UI checklist consume this
 * so an application can never be completed while required participant data,
 * consents, employer BA prerequisites, a measure, or signatures are missing.
 */
export function evaluateApplicationReadiness(
  data: ApplicationData,
): ApplicationReadiness {
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
  // Per-form signature classification (Epic C): required signers on the real BA
  // forms that are still unsigned, split by eIDAS level. SES gaps block (the
  // canvas path can satisfy them); QES gaps only warn — no connected provider,
  // so they are documented rather than faked or made an impossible blocker.
  const missingFormSignatures = findMissingSignatures(
    data.documents,
    data.signatures,
  );
  const missingSesSignatures = missingFormSignatures.filter(
    (s) => s.level === "SES",
  );
  const missingQesSignatures = missingFormSignatures.filter(
    (s) => s.level === "QES",
  );
  // Path-aware eService upload set (Epic C): once an application exists, the
  // required uploads for its applicant_type must be generated AND (where they
  // carry an SES signature) signed before submission. Skipped until an
  // application is present so the pure evaluator stays reusable for the
  // checklist preview on the documents page before an application is created.
  const uploadSet = data.application
    ? evaluateUploadSet({
        applicantType: resolveApplicantType(data.application.applicantType),
        documents: data.documents,
        signatures: data.signatures,
      })
    : { items: [], missingRequired: [] };

  const checks: ReadinessCheck[] = [
    {
      code: "participant_data",
      label: "Teilnehmerdaten vollständig",
      severity: "blocker",
      satisfied: participantComplete,
      state: participantComplete ? "ok" : "warn",
      hint: participantComplete
        ? undefined
        : "Geburtsdatum, Adresse oder Kontaktdaten fehlen",
    },
    {
      code: "consent_privacy",
      label: "Einwilligungen (Datenschutz) vorhanden",
      severity: "blocker",
      satisfied: hasConsent,
      state: hasConsent ? "ok" : "missing",
    },
    {
      code: "employer_data",
      label: "Arbeitgeberdaten vollständig",
      severity: "warning",
      satisfied: employerComplete,
      state: employerComplete ? "ok" : e ? "warn" : "missing",
      hint: e ? undefined : "Kein Arbeitgeber verknüpft",
    },
    {
      code: "betriebsnummer_missing",
      label: "Betriebsnummer vorhanden",
      severity: "blocker",
      satisfied: Boolean(e?.betriebsnummer),
      state: e?.betriebsnummer ? "ok" : "missing",
    },
    {
      code: "ags_unconfirmed",
      label: "Arbeitgeberservice-Status bestätigt",
      severity: "blocker",
      satisfied: e?.agsRegistered === true,
      state:
        e?.agsRegistered === true
          ? "ok"
          : e?.agsRegistered === false
            ? "warn"
            : "missing",
      hint: e?.agsRegistered === false ? "Registrierung noch erforderlich" : undefined,
    },
    {
      code: "time_model",
      label: "Zeitmodell 20 Std./Woche bestätigt (Arbeitgeber)",
      severity: "warning",
      satisfied: e?.timeModelStatus === "yes",
      state: e?.timeModelStatus === "yes" ? "ok" : "missing",
    },
    {
      code: "availability",
      label: "Verfügbarkeit bestätigt (Teilnehmer:in)",
      severity: "warning",
      satisfied: p.availabilityStatus === "yes",
      state: p.availabilityStatus === "yes" ? "ok" : "missing",
    },
    {
      code: "no_measure",
      label: "Maßnahmedaten vollständig",
      // A linked measure is the hard requirement; incomplete measure fields are
      // only a caution (state "warn"), never a blocker.
      severity: "blocker",
      satisfied: Boolean(m),
      state: m && m.azavNumber && m.startDate && m.costEur ? "ok" : m ? "warn" : "missing",
      hint: m ? undefined : "Keine Maßnahme zugeordnet",
    },
    {
      code: "documents",
      label: "Dokumente erstellt",
      severity: "warning",
      satisfied: generated.length >= 2,
      state: generated.length >= 2 ? "ok" : generated.length > 0 ? "warn" : "missing",
    },
    {
      code: "signatures_incomplete",
      label: "Erforderliche Signaturen vollständig",
      severity: "blocker",
      satisfied: signaturesComplete,
      state: signaturesComplete
        ? "ok"
        : data.signatures.length > 0
          ? "warn"
          : "missing",
    },
    {
      code: "form_signatures_ses",
      label: "Signaturen der BA-Formulare (SES) vollständig",
      severity: "blocker",
      satisfied: missingSesSignatures.length === 0,
      state: missingSesSignatures.length === 0 ? "ok" : "missing",
      hint:
        missingSesSignatures.length === 0
          ? undefined
          : "Unterschrift auf generierten Teilnehmerformularen ausstehend",
    },
    {
      code: "form_signatures_qes_pending",
      label: "QES-pflichtige Formulare signiert",
      // Warning, not blocker: no QES provider is connected yet, so this cannot
      // be satisfied without a vendor. Surfaced honestly instead of faked.
      severity: "warning",
      satisfied: missingQesSignatures.length === 0,
      state: missingQesSignatures.length === 0 ? "ok" : "warn",
      hint:
        missingQesSignatures.length === 0
          ? undefined
          : "QES erforderlich — Signaturanbieter noch nicht angebunden",
    },
    {
      code: "upload_set_incomplete",
      label: "eService-Upload-Set vollständig (erzeugt & signiert)",
      severity: "blocker",
      satisfied: uploadSet.missingRequired.length === 0,
      state: uploadSet.missingRequired.length === 0 ? "ok" : "missing",
      hint:
        uploadSet.missingRequired.length === 0
          ? undefined
          : `Fehlt: ${uploadSet.missingRequired.map((i) => i.label).join(", ")}`,
    },
  ];

  const blockers = checks.filter((c) => c.severity === "blocker" && !c.satisfied);
  const warnings = checks.filter((c) => c.severity === "warning" && !c.satisfied);
  return { ready: blockers.length === 0, checks, blockers, warnings };
}

export function buildChecklist(data: ApplicationData): ChecklistItem[] {
  return evaluateApplicationReadiness(data).checks.map(({ label, state, hint }) => ({
    label,
    state,
    hint,
  }));
}
