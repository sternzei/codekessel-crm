import { readFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { documents, signatures } from "@/db/schema";
import {
  loadTokenContext,
  verifyTokenSignature,
} from "@/modules/tokens/service";

// Streams the PDF behind a sign_document magic link. Access is exactly as
// scoped as the link itself: valid token → this one document, nothing else.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params;
  const rawToken = decodeURIComponent(token);

  const tokenSignature = await verifyTokenSignature(rawToken);
  if (!tokenSignature) return new Response("Not found", { status: 404 });

  const filePath = await withTenant(tokenSignature.tenantId, async (tx) => {
    const ctx = await loadTokenContext(tx, rawToken);
    if (!ctx.ok || ctx.tokenRow.scope !== "sign_document") return null;
    if (ctx.task.subjectKind !== "signature" || !ctx.task.subjectId) return null;

    const [sig] = await tx
      .select({ documentId: signatures.documentId })
      .from(signatures)
      .where(eq(signatures.id, ctx.task.subjectId));
    if (!sig) return null;

    const [doc] = await tx
      .select({
        filePath: documents.filePath,
        signedFilePath: documents.signedFilePath,
      })
      .from(documents)
      .where(eq(documents.id, sig.documentId));
    return doc?.signedFilePath ?? doc?.filePath ?? null;
  });

  if (!filePath) return new Response("Not found", { status: 404 });

  // filePath is app-generated ("var/documents/<uuid>.pdf") — resolve inside
  // the project root and reject anything that escapes it.
  const absolute = path.resolve(process.cwd(), filePath);
  if (!absolute.startsWith(path.join(process.cwd(), "var") + path.sep)) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const bytes = await readFile(absolute);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "inline; filename=dokument.pdf",
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
