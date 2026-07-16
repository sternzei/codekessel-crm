// Pure signature-progress logic. The set of signature rows on a document IS
// the required set (a consultant requests exactly the signers a document
// needs). A document is fully signed only when every requested signature is
// signed — parallel, any order.

export type SignerKind = "participant" | "employer" | "internal_user";

export interface SignatureLike {
  signerKind: SignerKind;
  status: string; // signatureStatus enum: pending | signed | declined | expired
}

export interface SignatureProgress {
  total: number;
  signed: number;
  remaining: number;
  /** True only when there is at least one signature and all are signed. */
  complete: boolean;
}

export function signatureProgress(
  signatures: readonly SignatureLike[],
): SignatureProgress {
  const total = signatures.length;
  const signed = signatures.filter((s) => s.status === "signed").length;
  const remaining = total - signed;
  return { total, signed, remaining, complete: total > 0 && remaining === 0 };
}

/**
 * A signer may be requested only if they have no active (pending or signed)
 * request yet — no duplicate signatures for the same party on one document.
 */
export function canRequestSigner(
  existing: readonly SignatureLike[],
  signerKind: SignerKind,
): boolean {
  return !existing.some(
    (s) =>
      s.signerKind === signerKind &&
      (s.status === "pending" || s.status === "signed"),
  );
}
