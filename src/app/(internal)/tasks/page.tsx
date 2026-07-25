import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { withTenant } from "@/db/client";
import { getSession } from "@/modules/auth/session";
import { completeTask } from "@/modules/participants/actions-internal";
import { issueLinkForTask, revokeTaskLink } from "@/modules/tasks/actions";
import { listOpenTasks } from "@/modules/tasks/queries";
import { deriveTaskLinkDisplayStatus } from "@/modules/tokens/link-status";
import {
  TaskWhatsAppButton,
  type TaskWhatsAppLabels,
} from "./task-whatsapp-button";

export const dynamic = "force-dynamic";

const OWNER_LABEL: Record<string, string> = {
  internal_user: "Intern",
  participant: "Teilnehmer:in",
  employer: "Arbeitgeber",
};

const CHANNEL_LABEL: Record<string, string> = {
  internal: "Interne Aufgabe",
  email: "E-Mail",
  whatsapp: "WhatsApp",
  magic_link: "Aufgaben-Link",
};

const WHATSAPP_CHANNELS = new Set(["whatsapp", "magic_link"]);

// Deterministic due-date formatting: pin the timezone to Europe/Berlin so the
// German calendar day is stable regardless of the runtime's ambient TZ (a
// timestamp near midnight UTC must not render on the wrong day). Built once at
// module scope.
const DUE_DATE_FORMATTER = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ link?: string; revoked?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/auth/sign-in");

  const t = await getTranslations("tasks");
  const waLabels: TaskWhatsAppLabels = {
    send: t("whatsapp.send"),
    opening: t("whatsapp.opening"),
    opened: t("whatsapp.opened"),
    open: t("whatsapp.open"),
    errors: {
      no_phone: t("whatsapp.errors.no_phone"),
      not_applicable: t("whatsapp.errors.not_applicable"),
      failed: t("whatsapp.errors.failed"),
    },
  };
  const { link, revoked } = await searchParams;
  const revokedMessage =
    revoked === undefined
      ? undefined
      : Number(revoked) > 0
        ? `Aufgaben-Link widerrufen (${Number(revoked)}). Der alte Link ist ab sofort ungültig.`
        : "Kein aktiver Link zum Widerrufen vorhanden.";
  const openTasks = await withTenant(session.tenantId, (tx) =>
    listOpenTasks(tx),
  );

  return (
    <>
      <header className="page-header">
        <h1>{t("title")}</h1>
        <p>{t("subtitle")}</p>
      </header>

      {revokedMessage ? (
        <p
          className={Number(revoked) > 0 ? "info-banner" : "gate-banner"}
          style={{ marginBottom: "var(--space-6)" }}
        >
          {revokedMessage}
        </p>
      ) : null}

      {link ? (
        <div className="card" style={{ marginBottom: "var(--space-6)" }}>
          <p style={{ fontSize: "var(--text-sm)", fontWeight: 600, marginBottom: "var(--space-2)" }}>
            Aufgaben-Link erstellt — per WhatsApp/E-Mail versenden:
          </p>
          <code data-testid="task-link" style={{ fontSize: "var(--text-xs)", wordBreak: "break-all", display: "block" }}>
            {link}
          </code>
        </div>
      ) : null}

      {openTasks.length === 0 ? (
        <div className="empty-state">{t("empty")}</div>
      ) : (
        <div className="data-list">
          {openTasks.map((task) => {
            const isExternal = task.ownerKind !== "internal_user";
            const canWhatsApp =
              isExternal &&
              WHATSAPP_CHANNELS.has(task.channel) &&
              task.ownerHasPhone;
            const linkStatus = deriveTaskLinkDisplayStatus({
              hasLiveLink: task.hasLiveLink,
              revokedLinkCount: task.revokedLinkCount,
            });
            return (
              <article
                key={task.id}
                className="data-row"
                style={{ gridTemplateColumns: "1fr auto auto auto auto auto" }}
              >
                <div>
                  <div className="title">{task.title}</div>
                  <div className="meta">
                    {OWNER_LABEL[task.ownerKind]}
                    {task.ownerName ? ` · ${task.ownerName}` : ""}
                    {task.dueAt
                      ? ` · fällig ${DUE_DATE_FORMATTER.format(task.dueAt)}`
                      : ""}
                  </div>
                </div>
                <span className="badge">{CHANNEL_LABEL[task.channel] ?? task.channel}</span>
                <span
                  className={
                    task.status === "escalated" ? "badge badge--danger" : "badge badge--warn"
                  }
                >
                  {task.status === "escalated" ? "Eskaliert" : "Offen"}
                </span>
                {isExternal && linkStatus !== "none" ? (
                  <span
                    className={
                      linkStatus === "revoked"
                        ? "badge badge--danger"
                        : "badge"
                    }
                    data-testid="task-link-status"
                  >
                    {linkStatus === "revoked" ? "Link widerrufen" : "Link aktiv"}
                  </span>
                ) : (
                  <span />
                )}
                {canWhatsApp ? (
                  <TaskWhatsAppButton taskId={task.id} labels={waLabels} />
                ) : (
                  <span />
                )}
                {task.ownerKind === "internal_user" ? (
                  <form action={completeTask}>
                    <input type="hidden" name="taskId" value={task.id} />
                    <button type="submit" className="button button--sm button--ghost">
                      Erledigt
                    </button>
                  </form>
                ) : (
                  <div style={{ display: "flex", gap: "var(--space-2)" }}>
                    <form action={issueLinkForTask}>
                      <input type="hidden" name="taskId" value={task.id} />
                      <button type="submit" className="button button--sm button--ghost">
                        Link erzeugen
                      </button>
                    </form>
                    {task.hasLiveLink ? (
                      <form action={revokeTaskLink}>
                        <input type="hidden" name="taskId" value={task.id} />
                        <button
                          type="submit"
                          className="button button--sm button--ghost"
                        >
                          Link widerrufen
                        </button>
                      </form>
                    ) : null}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
