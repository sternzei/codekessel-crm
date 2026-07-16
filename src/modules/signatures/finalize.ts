import path from "node:path";
import { eq, sql } from "drizzle-orm";
import type { DbHandle } from "@/db/client";
import { documents, signatures } from "@/db/schema";
import { generateSignedArtifact } from "@/modules/documents/generate";
import { signatureProgress } from "./progress";

/**
 * Called after one signature is marked signed. If every required signature on
 * the document is now signed, builds the signed artifact (stamp + audit
 * certificate), stores it on the document, and returns { finalized: true }.
 * Otherwise marks the document `partially_signed` and returns false.
 *
 * A `FOR UPDATE` lock on the document row serializes concurrent co-signers so
 * two simultaneous submissions cannot both finalize.
 */
export async function finalizeIfComplete(
  tx: DbHandle,
  documentId: string,
): Promise<{ finalized: boolean }> {
  await tx.execute(
    sql`select 1 from documents where id = ${documentId} for update`,
  );

  const sigRows = await tx
    .select()
    .from(signatures)
    .where(eq(signatures.documentId, documentId));
  const progress = signatureProgress(sigRows);

  const [doc] = await tx
    .select()
    .from(documents)
    .where(eq(documents.id, documentId));
  if (!doc) return { finalized: false };

  if (!progress.complete) {
    if (doc.status !== "partially_signed") {
      await tx
        .update(documents)
        .set({ status: "partially_signed" })
        .where(eq(documents.id, documentId));
    }
    return { finalized: false };
  }

  if (doc.filePath) {
    const artifact = await generateSignedArtifact({
      originalRelativePath: doc.filePath,
      documentTitle: doc.title,
      originalSha256: doc.sha256 ?? "",
      signatures: sigRows.map((s) => ({
        signerKind: s.signerKind,
        signerName: s.signerName ?? "",
        signedAt: s.signedAt ?? new Date(),
        ipAddress: s.ipAddress ?? "unknown",
        provider: s.provider,
        imagePath: s.signatureImagePath
          ? path.resolve(process.cwd(), s.signatureImagePath)
          : null,
      })),
    });
    await tx
      .update(documents)
      .set({
        status: "signed",
        signedFilePath: artifact.relativePath,
        signedSha256: artifact.sha256,
      })
      .where(eq(documents.id, documentId));
  } else {
    await tx
      .update(documents)
      .set({ status: "signed" })
      .where(eq(documents.id, documentId));
  }

  return { finalized: true };
}
