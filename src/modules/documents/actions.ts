"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { documents, signatures } from "@/db/schema";
import { logActivity } from "@/modules/audit/log";
import { getSession } from "@/modules/auth/session";
import { processTransition } from "@/modules/routing/engine";
import { canRequestSigner } from "@/modules/signatures/progress";
import { collectApplicationData, collectCompanyCohort, type ApplicationData } from "./data";
import type { CohortParticipant } from "./ba-forms";
import {
  generateCostOverview,
  generateEmployerDatasheet,
  generateEServiceCompanionCompany,
  generateEServiceCompanionSingle,
  generateParticipantForm,
  generateTeilnehmerliste,
  generateTraegerbescheinigung,
  type GeneratedFile,
} from "./generate";

type DocSpec = {
  title: string;
  /** Which applicant path the document belongs to (concept: same doc pool,
   * split logic — see docs/ESERVICE-ANTRAG.md). */
  path: "single" | "company" | "internal";
  generate: (d: ApplicationData, cohort: CohortParticipant[]) => Promise<GeneratedFile>;
  requires: (d: ApplicationData) => boolean;
};

const DOC_TYPES: Record<string, DocSpec> = {
  // ---- Einzelantrag (eService "Arbeitsentgeltzuschuss – Antrag", 6 Schritte)
  traegerbescheinigung: {
    title: "Trägerbescheinigung (BA ba042369)",
    path: "single",
    generate: (d) => generateTraegerbescheinigung(d),
    requires: (d) => Boolean(d.measure?.startDate),
  },
  eservice_single: {
    title: "eService-Begleitblatt Einzelantrag",
    path: "single",
    generate: (d) => generateEServiceCompanionSingle(d),
    requires: (d) => Boolean(d.employer && d.measure),
  },
  // ---- Sammelantrag (Firma, eService 7 Schritte)
  teilnehmerliste: {
    title: "Sammelantrag-Teilnehmerliste (BA I FW 501/502)",
    path: "company",
    generate: (d, cohort) => generateTeilnehmerliste(d, cohort),
    requires: (d) => Boolean(d.employer && d.measure),
  },
  eservice_company: {
    title: "eService-Begleitblatt Sammelantrag",
    path: "company",
    generate: (d, cohort) => generateEServiceCompanionCompany(d, cohort.length),
    requires: (d) => Boolean(d.employer && d.measure),
  },
  // ---- Interne Dokumente
  participant_form: {
    title: "Teilnehmer-Stammblatt (Muster)",
    path: "internal",
    generate: (d) => generateParticipantForm(d),
    requires: (d) =>
      Boolean(d.measure && d.participant.dateOfBirth && d.participant.street),
  },
  cost_overview: {
    title: "Kostenübersicht",
    path: "internal",
    generate: (d) => generateCostOverview(d),
    requires: (d) => Boolean(d.measure?.costEur),
  },
  employer_datasheet: {
    title: "Arbeitgeber-Datenblatt",
    path: "internal",
    generate: (d) => generateEmployerDatasheet(d),
    requires: (d) => Boolean(d.employer),
  },
};

type DocType = keyof typeof DOC_TYPES;

/**
 * Generates (or flags as data_missing) one document from central data.
 * Missing prerequisites do NOT fail silently: a data_missing document row
 * is created and the routing rule assigns a completion task.
 */
export async function generateDocument(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/auth/sign-in");

  const participantId = z.string().uuid().parse(formData.get("participantId"));
  const type = z
    .enum(Object.keys(DOC_TYPES) as [DocType, ...DocType[]])
    .parse(formData.get("type"));

  await withTenant(session.tenantId, async (tx) => {
    const data = await collectApplicationData(tx, participantId);
    if (!data) return;

    const spec = DOC_TYPES[type];
    // Company-path documents cover the whole cohort (same employer + measure).
    const cohort =
      spec.path === "company" &&
      data.participant.employerId &&
      data.participant.measureId
        ? await collectCompanyCohort(
            tx,
            data.participant.employerId,
            data.participant.measureId,
          )
        : [];
    let file: GeneratedFile | null = null;
    if (spec.requires(data)) {
      file = await spec.generate(data, cohort);
    }

    const [doc] = await tx
      .insert(documents)
      .values({
        tenantId: session.tenantId,
        type,
        title: spec.title,
        status: file ? "prefilled" : "data_missing",
        participantId,
        employerId: data.participant.employerId,
        templateKey: type,
        filePath: file?.relativePath,
        sha256: file?.sha256,
      })
      .returning({ id: documents.id, status: documents.status });

    await processTransition(tx, {
      tenantId: session.tenantId,
      entity: "document",
      entityId: doc.id,
      status: doc.status,
      actorKind: "internal_user",
      actorUserId: session.id,
      context: {
        participantId,
        employerId: data.participant.employerId ?? undefined,
        consultantId: data.participant.assignedConsultantId ?? session.id,
      },
    });
  });

  revalidatePath(`/documents/${participantId}`);
}

/**
 * Requests a signature on a document. The signer (participant or employer)
 * is put into the transition context alone, so exactly one of the two
 * signature routing rules matches — that rule creates the task, issues the
 * magic link, sends the message, and schedules reminders + escalation.
 */
export async function requestSignature(formData: FormData): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/auth/sign-in");

  const documentId = z.string().uuid().parse(formData.get("documentId"));
  const signerKind = z
    .enum(["participant", "employer"])
    .parse(formData.get("signerKind"));

  await withTenant(session.tenantId, async (tx) => {
    const [doc] = await tx
      .select()
      .from(documents)
      .where(eq(documents.id, documentId));
    if (!doc || !doc.filePath) return;
    // Nothing left to request once the document is fully signed.
    if (doc.status === "signed") return;

    const signerParticipantId =
      signerKind === "participant" ? doc.participantId : null;
    const signerEmployerId = signerKind === "employer" ? doc.employerId : null;
    if (!signerParticipantId && !signerEmployerId) return;

    // No duplicate active request for the same party on one document.
    const existingSigs = await tx
      .select({ signerKind: signatures.signerKind, status: signatures.status })
      .from(signatures)
      .where(eq(signatures.documentId, documentId));
    if (!canRequestSigner(existingSigs, signerKind)) return;

    const [signatureRow] = await tx
      .insert(signatures)
      .values({
        tenantId: session.tenantId,
        documentId,
        signerKind,
        signerParticipantId,
        signerEmployerId,
        provider: "canvas",
      })
      .returning({ id: signatures.id });

    await logActivity(tx, {
      tenantId: session.tenantId,
      actorKind: "internal_user",
      actorUserId: session.id,
      subjectKind: "signature",
      subjectId: signatureRow.id,
      event: "signature_requested",
      meta: { documentId, signerKind },
    });

    await processTransition(tx, {
      tenantId: session.tenantId,
      entity: "signature",
      entityId: signatureRow.id,
      status: "pending",
      actorKind: "internal_user",
      actorUserId: session.id,
      context: {
        // Only the signer — guarantees a single rule match.
        participantId: signerParticipantId ?? undefined,
        employerId: signerEmployerId ?? undefined,
      },
    });
  });

  if (formData.get("returnTo") === "documents") {
    const pid = formData.get("participantId");
    if (typeof pid === "string") revalidatePath(`/documents/${pid}`);
  }
}
