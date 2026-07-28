import { withTenant } from "@/db/client";
import { getSession } from "@/modules/auth/session";
import {
  buildPipelineCsv,
  parsePipelineFilter,
  type ExportRow,
} from "@/modules/participants/pipeline-filter";
import { listPipelineForExport } from "@/modules/participants/pipeline";

// CSV export of the CURRENT filtered result set. Session required; the filter
// is parsed from the same searchParams the pipeline page uses, so the export
// exactly reflects what the consultant is looking at. RLS scopes every row.
export async function GET(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const url = new URL(request.url);
  const raw: Record<string, string | string[] | undefined> = {};
  for (const key of new Set(url.searchParams.keys())) {
    const all = url.searchParams.getAll(key);
    raw[key] = all.length > 1 ? all : all[0];
  }
  const filter = parsePipelineFilter(raw);

  const rows: ExportRow[] = await withTenant(session.tenantId, (tx) =>
    listPipelineForExport(tx, filter, {
      userId: session.id,
      role: session.role,
    }),
  );
  const csv = buildPipelineCsv(rows);
  const today = new Date().toISOString().slice(0, 10);
  // UTF-8 BOM so Excel opens the German umlauts correctly.
  return new Response(`\uFEFF${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="pipeline-${today}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
