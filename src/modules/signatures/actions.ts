"use server";

import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { documents, signatures } from "@/db/schema";
import { requestClientIp } from "@/lib/client-ip";
import { logActivity } from "@/modules/audit/log";
import { processTransition } from "@/modules/routing/engine";
import {
  completeTaskViaToken,
  loadTokenContext,
  verifyTokenSignature,
} from "@/modules/tokens/service";
import { isExternalActionThrottled } from "@/modules/tokens/request-throttle";
import { getSignatureProvider } from "./provider";
import { finalizeIfComplete } from "./finalize";

const signSchema = z.object({
  token: z.string().min(10),
  signerName: z.string().trim().min(3).max(200),
  // data:image/png;base64,... from the signature pad
  signatureDataUrl: z.string().startsWith("data:image/png;base64,").max(500_000),
  confirmed: z.literal("on"),
});

/**
 * External task: signer opens the magic link, reviews the document, draws
 * a signature, confirms. Audit evidence (name, timestamp, IP, document
 * hash) is stored with the signature; document → signed; token burned.
 */
export async function signDocument(formData: FormData): Promise<void> {
  if (await isExternalActionThrottled()) {
    redirect(`/t/${String(formData.get("token") ?? "")}?throttled=1`);
  }
  const parsed = signSchema.safeParse({
    token: formData.get("token"),
    signerName: formData.get("signerName"),
    signatureDataUrl: formData.get("signatureDataUrl"),
    confirmed: formData.get("confirmed"),
  });
  if (!parsed.success) return;
  const input = parsed.data;

  const tokenSignature = await verifyTokenSignature(input.token);
  if (!tokenSignature) redirect(`/t/${input.token}`);

  const headerStore = await headers();
  // Audit trail: null unless the IP is honestly knowable (see lib/client-ip).
  const ipAddress = requestClientIp(headerStore);

  const ok = await withTenant(tokenSignature.tenantId, async (tx) => {
    const ctx = await loadTokenContext(tx, input.token);
    if (!ctx.ok || ctx.tokenRow.scope !== "sign_document") return false;
    if (ctx.task.subjectKind !== "signature" || !ctx.task.subjectId) {
      return false;
    }

    const [signatureRow] = await tx
      .select()
      .from(signatures)
      .where(eq(signatures.id, ctx.task.subjectId));
    if (!signatureRow || signatureRow.status !== "pending") return false;

    const [doc] = await tx
      .select()
      .from(documents)
      .where(eq(documents.id, signatureRow.documentId));
    if (!doc) return false;

    // Burn FIRST: the atomic gate. On a concurrent double-submit the loser
    // stops here — no duplicate artifact, no overwritten signature row.
    if (!(await completeTaskViaToken(tx, ctx))) return false;

    const imageBytes = Buffer.from(
      input.signatureDataUrl.split(",")[1],
      "base64",
    );
    const provider = getSignatureProvider(signatureRow.provider);
    const signedAt = new Date();
    const { imagePath } = await provider.finalize({
      signatureId: signatureRow.id,
      evidence: {
        signerName: input.signerName,
        ipAddress,
        documentSha256: doc.sha256 ?? "",
        signedAt,
      },
      imageBytes,
    });

    await tx
      .update(signatures)
      .set({
        status: "signed",
        signerName: input.signerName,
        signedAt,
        ipAddress,
        documentSha256: doc.sha256,
        signatureImagePath: imagePath,
      })
      .where(eq(signatures.id, signatureRow.id));

    await logActivity(tx, {
      tenantId: tokenSignature.tenantId,
      actorKind: ctx.tokenRow.subjectKind,
      subjectKind: "signature",
      subjectId: signatureRow.id,
      event: "document_signed",
      meta: { documentId: doc.id, provider: signatureRow.provider },
    });

    // Only advance the document (and fire the downstream rule) once EVERY
    // requested signature is collected; finalize builds the signed artifact.
    const { finalized } = await finalizeIfComplete(tx, doc.id);
    if (finalized) {
      await processTransition(tx, {
        tenantId: tokenSignature.tenantId,
        entity: "document",
        entityId: doc.id,
        status: "signed",
        actorKind: ctx.tokenRow.subjectKind,
        context: {
          participantId: doc.participantId ?? undefined,
          employerId: doc.employerId ?? undefined,
        },
      });
    }
    return true;
  });

  redirect(ok ? `/t/${input.token}?done=1` : `/t/${input.token}`);
}
