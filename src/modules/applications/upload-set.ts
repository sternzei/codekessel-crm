import {
  documentRequiresSignature,
  findMissingSignatures,
} from "@/modules/signatures/requirements";

// eService upload sets (Epic C / docs/ESERVICE-ANTRAG.md). The two application
// paths share one document pool but require different uploads. This is the
// single, path-aware definition consumed by the readiness evaluator, the
// package export cover and the internal application/documents page, so the gate
// and the surfaced status can never diverge.

export type ApplicantType = "single" | "company";

export type UploadSetEntry = {
  readonly type: string;
  readonly label: string;
  /** Required uploads gate submission-complete; optional ones only surface. */
  readonly required: boolean;
};

export const ESERVICE_UPLOAD_SETS: Readonly<
  Record<ApplicantType, readonly UploadSetEntry[]>
> = {
  // Einzelantrag ("Arbeitsentgeltzuschuss – Antrag", 6 Schritte): step 3 upload
  // Trägerbescheinigung; the employee's own declaration is the signed AEZ
  // upload. Fragebogen is supplemental; Vollmacht is QES-blocked (optional so it
  // never becomes an impossible blocker without a provider).
  single: [
    { type: "traegerbescheinigung", label: "Trägerbescheinigung (ba042369)", required: true },
    { type: "arbeitnehmererklaerung", label: "Arbeitnehmererklärung (ba042354)", required: true },
    { type: "fragebogen", label: "Teilnehmer-Fragebogen (ba046157)", required: false },
    { type: "vollmacht", label: "Vollmacht (ba051211)", required: false },
  ],
  // Sammelantrag (Firma, 7 Schritte): Lehrgangskosten-Nachweis (step 2) and the
  // Teilnehmerliste (step 4). The Träger-/Maßnahmezertifikate are static files
  // uploaded straight from templates/documents and are not tracked as documents.
  company: [
    {
      type: "teilnehmerliste",
      label: "Sammelantrag-Teilnehmerliste (BA I FW 501/502)",
      required: true,
    },
    { type: "cost_overview", label: "Lehrgangskosten-Nachweis (Kostenübersicht)", required: true },
  ],
};

export type UploadDocumentLike = {
  id: string;
  type: string;
  filePath: string | null;
};

export type UploadSignatureLike = {
  documentId: string;
  signerKind: string;
  status: string;
};

export type UploadItemStatus = {
  type: string;
  label: string;
  required: boolean;
  present: boolean;
  requiresSignature: boolean;
  /** Present and every SES signer signed (QES gaps are tracked separately). */
  signed: boolean;
  /** A QES signer is still outstanding (no connected provider). */
  qesPending: boolean;
};

export function resolveApplicantType(
  value: string | null | undefined,
): ApplicantType {
  return value === "company" ? "company" : "single";
}

/**
 * Status of every upload-set entry for the path, plus the required entries that
 * are still incomplete (not generated, or generated but missing an SES
 * signature). QES-required entries never enter `missingRequired` — no provider
 * is connected, so they are surfaced (`qesPending`) rather than made a blocker.
 */
export function evaluateUploadSet(params: {
  applicantType: ApplicantType;
  documents: readonly UploadDocumentLike[];
  signatures: readonly UploadSignatureLike[];
}): { items: UploadItemStatus[]; missingRequired: UploadItemStatus[] } {
  const items = ESERVICE_UPLOAD_SETS[params.applicantType].map((entry) => {
    const present = params.documents.filter(
      (d) => d.type === entry.type && Boolean(d.filePath),
    );
    const isPresent = present.length > 0;
    const requiresSignature = documentRequiresSignature(entry.type);
    const missing = findMissingSignatures(present, params.signatures);
    const missingSes = missing.some((s) => s.level === "SES");
    const qesPending = missing.some((s) => s.level === "QES");
    const signed = requiresSignature ? isPresent && !missingSes : isPresent;
    return {
      type: entry.type,
      label: entry.label,
      required: entry.required,
      present: isPresent,
      requiresSignature,
      signed,
      qesPending,
    };
  });
  const missingRequired = items.filter((i) => i.required && !i.signed);
  return { items, missingRequired };
}
