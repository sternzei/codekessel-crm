import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { withTenant } from "@/db/client";
import { appointments, participants, users } from "@/db/schema";
import { getSession } from "@/modules/auth/session";
import { setAppointmentStatus } from "@/modules/participants/actions-internal";
import { fmtDateTime } from "../leads/[id]/labels";

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = {
  follow_up: "Folgetermin",
  consultation: "Beratung",
  aptitude_test: "Eignungstest",
};

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  scheduled: { label: "Geplant", cls: "badge" },
  reminder_sent: { label: "Erinnert", cls: "badge badge--warn" },
  no_show: { label: "No-Show", cls: "badge badge--danger" },
  completed: { label: "Abgeschlossen", cls: "badge badge--ok" },
  rescheduled: { label: "Verschoben", cls: "badge badge--warn" },
  cancelled: { label: "Abgesagt", cls: "badge badge--danger" },
};

export default async function AppointmentsPage() {
  const session = await getSession();
  if (!session) redirect("/auth/sign-in");

  const rows = await withTenant(session.tenantId, (tx) =>
    tx
      .select({
        appointment: appointments,
        participantId: participants.id,
        participantName: participants.firstName,
        participantLastName: participants.lastName,
        consultantName: users.name,
      })
      .from(appointments)
      .innerJoin(participants, eq(appointments.participantId, participants.id))
      .leftJoin(users, eq(appointments.consultantId, users.id))
      .orderBy(desc(appointments.scheduledAt)),
  );

  return (
    <>
      <header className="page-header">
        <h1>Termine</h1>
        <p>
          Erinnerungen (24h/2h WhatsApp + Anruf-Aufgabe) werden beim Planen
          automatisch erzeugt. Termine werden am Lead geplant.
        </p>
      </header>

      {rows.length === 0 ? (
        <div className="empty-state">
          Keine Termine. Termine werden auf der Lead-Detailseite geplant.
        </div>
      ) : (
        <div className="data-list">
          {rows.map(({ appointment: apt, ...row }) => (
            <article key={apt.id} className="data-row" style={{ gridTemplateColumns: "1fr auto auto auto" }}>
              <div>
                <div className="title">
                  <Link href={`/leads/${row.participantId}`}>
                    {row.participantName} {row.participantLastName}
                  </Link>{" "}
                  · {TYPE_LABEL[apt.type]}
                </div>
                <div className="meta">
                  {fmtDateTime(apt.scheduledAt)}
                  {row.consultantName ? ` · ${row.consultantName}` : ""}
                  {apt.notes ? ` · ${apt.notes}` : ""}
                </div>
              </div>
              <span className={STATUS_LABEL[apt.status]?.cls ?? "badge"}>
                {STATUS_LABEL[apt.status]?.label ?? apt.status}
              </span>
              {apt.status === "scheduled" || apt.status === "reminder_sent" ? (
                <>
                  <form action={setAppointmentStatus}>
                    <input type="hidden" name="appointmentId" value={apt.id} />
                    <input type="hidden" name="status" value="completed" />
                    <button type="submit" className="button button--sm">
                      Stattgefunden
                    </button>
                  </form>
                  <form action={setAppointmentStatus}>
                    <input type="hidden" name="appointmentId" value={apt.id} />
                    <input type="hidden" name="status" value="no_show" />
                    <button type="submit" className="button button--sm button--danger">
                      No-Show
                    </button>
                  </form>
                </>
              ) : (
                <span />
              )}
            </article>
          ))}
        </div>
      )}
    </>
  );
}
