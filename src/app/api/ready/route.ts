import { collectReadiness } from "@/modules/health/readiness";

// Deep readiness probe for monitoring. Separate from /api/health on purpose:
// health is liveness (is this process serving?) and drives the container
// healthcheck, so a dead worker or a stalled outbox must not restart the web
// tier. This endpoint is what a monitor should page on.
//
// 200 = ok, 503 = degraded or failed. Unauthenticated but info-light: per-check
// statuses only, no counts, no identifiers.
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const report = await collectReadiness();
  return Response.json(report, { status: report.status === "ok" ? 200 : 503 });
}
