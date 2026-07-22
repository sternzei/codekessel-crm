// Per-document-type signature classification (Epic C, US C2). The SINGLE
// source of truth for *which* BA forms need *whose* signature and at which
// eIDAS level. Consumed by the readiness evaluator (documents/data.ts), the
// signing action + UI (requestSignature / documents page) and DOC_TYPES so a
// form can never be signed by the wrong party or count a fake QES.
//
// Level semantics:
//  - "SES": simple electronic signature — the drawn-canvas provider is fully
//    implemented and exercised end-to-end via the magic-link flow.
//  - "QES": qualified electronic signature (legally qualified). NO provider is
//    connected yet. QES requirements are marked required-but-QES and stay
//    behind the existing `SignatureProvider` seam; they are NEVER satisfied by
//    the canvas (SES) path — doing so would fake a QES.

export type SignatureSignerKind = "participant" | "employer" | "internal_user";

export type SignatureLevel = "SES" | "QES";

export type RequiredSigner = {
  readonly kind: SignatureSignerKind;
  readonly level: SignatureLevel;
};

export type DocumentSignatureRequirement = {
  readonly signers: readonly RequiredSigner[];
};

// The three real BA forms wired this cycle. Arbeitnehmererklärung and
// Fragebogen are the participant's own declarations → SES (canvas) is adequate.
// The Vollmacht (power of attorney, ba051211) is legally sensitive → it needs a
// QES, which no connected provider can produce yet; it is therefore flagged and
// kept unsignable through the canvas path rather than faked.
export const DOCUMENT_SIGNATURE_REQUIREMENTS: Readonly<
  Record<string, DocumentSignatureRequirement>
> = {
  arbeitnehmererklaerung: { signers: [{ kind: "participant", level: "SES" }] },
  fragebogen: { signers: [{ kind: "participant", level: "SES" }] },
  vollmacht: { signers: [{ kind: "participant", level: "QES" }] },
};

export function getDocumentSignatureRequirement(
  type: string,
): DocumentSignatureRequirement | null {
  return DOCUMENT_SIGNATURE_REQUIREMENTS[type] ?? null;
}

export function documentRequiresSignature(type: string): boolean {
  return (DOCUMENT_SIGNATURE_REQUIREMENTS[type]?.signers.length ?? 0) > 0;
}

/** Required signers for a document type, optionally filtered by eIDAS level. */
export function requiredSignersFor(
  type: string,
  level?: SignatureLevel,
): RequiredSigner[] {
  const signers = DOCUMENT_SIGNATURE_REQUIREMENTS[type]?.signers ?? [];
  return (level ? signers.filter((s) => s.level === level) : signers).slice();
}

/**
 * True when this signer can be captured through the canvas (SES) magic-link
 * flow for this document. QES-level signers return false — no connected
 * provider, so the canvas path must not be offered for them.
 */
export function isCanvasSignableSigner(
  type: string,
  kind: SignatureSignerKind,
): boolean {
  return requiredSignersFor(type, "SES").some((s) => s.kind === kind);
}

export type DocumentLike = { id: string; type: string };

export type SignatureRecordLike = {
  documentId: string;
  signerKind: string;
  status: string;
};

export type MissingSignature = {
  documentId: string;
  documentType: string;
  signerKind: SignatureSignerKind;
  level: SignatureLevel;
};

/**
 * Across the *generated* documents, every required signer that has not yet
 * produced a `signed` signature. A document that was never generated cannot be
 * signed, so only present documents are inspected here — the full path-specific
 * upload set is enforced separately in the readiness evaluator.
 */
export function findMissingSignatures(
  documents: readonly DocumentLike[],
  signatures: readonly SignatureRecordLike[],
): MissingSignature[] {
  const missing: MissingSignature[] = [];
  for (const doc of documents) {
    const requirement = DOCUMENT_SIGNATURE_REQUIREMENTS[doc.type];
    if (!requirement) continue;
    for (const signer of requirement.signers) {
      const isSigned = signatures.some(
        (s) =>
          s.documentId === doc.id &&
          s.signerKind === signer.kind &&
          s.status === "signed",
      );
      if (isSigned) continue;
      missing.push({
        documentId: doc.id,
        documentType: doc.type,
        signerKind: signer.kind,
        level: signer.level,
      });
    }
  }
  return missing;
}
