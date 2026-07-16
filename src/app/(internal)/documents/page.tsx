import Link from "next/link";
import { asc, eq, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { withTenant } from "@/db/client";
import { documents, participants } from "@/db/schema";
import { getSession } from "@/modules/auth/session";

export const dynamic = "force-dynamic";

export default async function DocumentsPage() {
  const session = await getSession();
  if (!session) redirect("/auth/sign-in");

  const rows = await withTenant(session.tenantId, (tx) =>
    tx
      .select({
        id: participants.id,
        firstName: participants.firstName,
        lastName: participants.lastName,
        status: participants.status,
        docCount: sql<number>`count(${documents.id})::int`,
      })
      .from(participants)
      .leftJoin(documents, eq(documents.participantId, participants.id))
      .groupBy(participants.id)
      .orderBy(asc(participants.lastName)),
  );

  return (
    <>
      <header className="page-header">
        <h1>Dokumente</h1>
        <p>
          Zentrale Datensammlung → Checkliste → PDF-Erstellung → Signatur.
          Alle Dokumente werden aus einmal erfassten Daten erzeugt.
        </p>
      </header>

      <div className="data-list">
        {rows.map((p) => (
          <article key={p.id} className="data-row">
            <div>
              <div className="title">
                <Link href={`/documents/${p.id}`}>
                  {p.firstName} {p.lastName}
                </Link>
              </div>
              <div className="meta">Status: {p.status}</div>
            </div>
            <span className="badge">
              {p.docCount} Dokument{p.docCount === 1 ? "" : "e"}
            </span>
            <Link href={`/documents/${p.id}`} className="button button--sm button--ghost">
              Checkliste öffnen
            </Link>
          </article>
        ))}
      </div>
    </>
  );
}
