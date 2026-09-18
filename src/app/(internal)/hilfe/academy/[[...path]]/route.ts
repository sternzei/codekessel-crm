import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { HANDBOOK_ROOT, resolveHandbookAsset } from "@/modules/handbook/assets";
import { prepareHandbookHtml } from "@/modules/handbook/html";
import { getSession } from "@/modules/auth/session";

export const dynamic = "force-dynamic";

const HANDBOOK_BASE_HREF = "/hilfe/academy/";

type HandbookRouteContext = {
  readonly params: Promise<{ path?: string[] }>;
};

/**
 * Serves the QCG CRM Academy as a standalone document at /hilfe/academy.
 * It is outside the help-page React tree so a click can open a fresh tab.
 */
export async function GET(
  request: Request,
  context: HandbookRouteContext,
): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return NextResponse.redirect(new URL("/auth/sign-in", request.url));
  }
  const { path: segments } = await context.params;
  const asset = resolveHandbookAsset({
    root: HANDBOOK_ROOT,
    segments,
  });
  if (!asset) return new Response("Not found", { status: 404 });
  try {
    const bytes = await readFile(asset.absolutePath);
    if (asset.isHtml) {
      const html = prepareHandbookHtml(bytes.toString("utf8"), HANDBOOK_BASE_HREF);
      return new Response(html, {
        headers: {
          "Content-Type": asset.contentType,
          "Cache-Control": "private, no-store",
        },
      });
    }
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": asset.contentType,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
