import { readFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { documents } from "@/db/schema";
import { getSession } from "@/modules/auth/session";

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

  const absolute = path.resolve(process.cwd(), servePath);
  if (!absolute.startsWith(path.join(process.cwd(), "var") + path.sep)) {
    return new Response("Not found", { status: 404 });
  }

  const contentType =
    { ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg" }[
      path.extname(absolute)
    ] ?? "application/octet-stream";

  try {
    const bytes = await readFile(absolute);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `inline; filename="${doc.title.replaceAll('"', "")}${path.extname(absolute)}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
