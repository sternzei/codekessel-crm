import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { withTenant } from "@/db/client";
import { getSession } from "@/modules/auth/session";
import { completeTask } from "@/modules/participants/actions-internal";
import { issueLinkForTask, sendTaskWhatsApp } from "@/modules/tasks/actions";
import { listOpenTasks } from "@/modules/tasks/queries";

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

const WA_MESSAGES: Record<string, string> = {
  ok: "WhatsApp-Nachricht gesendet.",
  no_phone: "Keine Telefonnummer hinterlegt — WhatsApp nicht möglich.",
  no_consent: "Kein WhatsApp-Opt-in — Nachricht nicht gesendet.",
  not_applicable: "Aufgabe eignet sich nicht für WhatsApp.",
  failed: "WhatsApp-Versand fehlgeschlagen. Bitte später erneut versuchen.",
};

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ link?: string; wa?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/auth/sign-in");

  const t = await getTranslations("tasks");
  const { link, wa } = await searchParams;
  const waMessage = wa ? WA_MESSAGES[wa] : undefined;
  const openTasks = await withTenant(session.tenantId, (tx) =>
    listOpenTasks(tx),
  );

  return (
    <>
      <header className="page-header">
        <h1>{t("title")}</h1>
        <p>{t("subtitle")}</p>
      </header>

      {waMessage ? (
        <p
          className={wa === "ok" ? "info-banner" : "gate-banner"}
          style={{ marginBottom: "var(--space-6)" }}
        >
          {waMessage}
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
            const canWhatsApp =
              task.ownerKind !== "internal_user" &&
              WHATSAPP_CHANNELS.has(task.channel) &&
              task.ownerHasPhone;
            return (
              <article
                key={task.id}
                className="data-row"
                style={{ gridTemplateColumns: "1fr auto auto auto auto" }}
              >
                <div>
                  <div className="title">{task.title}</div>
                  <div className="meta">
                    {OWNER_LABEL[task.ownerKind]}
                    {task.ownerName ? ` · ${task.ownerName}` : ""}
                    {task.dueAt
                      ? ` · fällig ${task.dueAt.toLocaleDateString("de-DE")}`
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
                {canWhatsApp ? (
                  <form action={sendTaskWhatsApp}>
                    <input type="hidden" name="taskId" value={task.id} />
                    <button type="submit" className="button button--sm button--ghost">
                      WhatsApp senden
                    </button>
                  </form>
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
                  <form action={issueLinkForTask}>
                    <input type="hidden" name="taskId" value={task.id} />
                    <button type="submit" className="button button--sm button--ghost">
                      Link erzeugen
                    </button>
                  </form>
                )}
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
