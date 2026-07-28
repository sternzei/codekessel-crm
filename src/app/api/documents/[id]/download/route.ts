import path from "node:path";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { documents } from "@/db/schema";
import { getSession } from "@/modules/auth/session";
import { getStorage } from "@/modules/storage";

// Internal document download: session required; RLS scopes the lookup.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const doc = await withTenant(session.tenantId, async (tx) => {
    const [row] = await tx
      .select({
        filePath: documents.filePath,
        signedFilePath: documents.signedFilePath,
        title: documents.title,
      })
      .from(documents)
      .where(eq(documents.id, id));
    return row ?? null;
  });
  // Prefer the signed artifact (stamp + certificate) once it exists.
  const servePath = doc?.signedFilePath ?? doc?.filePath;
  if (!servePath) return new Response("Not found", { status: 404 });

  // servePath is a storage key we wrote (never client-supplied). The adapter
  // enforces its own boundaries (local: within the storage root; s3: within the
  // bucket/prefix); a bad/missing key surfaces as a rejected get → 404.
  const extension = path.extname(servePath).toLowerCase();
  const contentType =
    { ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg" }[
      extension
    ] ?? "application/octet-stream";

  try {
    const bytes = await getStorage().get(servePath);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `inline; filename="${doc.title.replaceAll('"', "")}${extension}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
