import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { HelpLink } from "@/components/help/help-link";
import { withTenant } from "@/db/client";
import { getSession } from "@/modules/auth/session";
import { resolveAdapterMode } from "@/modules/messaging/adapters";
import { completeTask } from "@/modules/participants/actions-internal";
import { issueLinkForTask, revokeTaskLink } from "@/modules/tasks/actions";
import { listOpenTasks } from "@/modules/tasks/queries";
import { deriveTaskLinkDisplayStatus } from "@/modules/tokens/link-status";
import { TaskLinkBanner } from "./task-link-banner";
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

const WA_BANNER: Record<string, { readonly kind: "info" | "gate"; readonly text: string }> = {
  sent: {
    kind: "info",
    text: "WhatsApp-Nachricht über die Firmennummer versendet.",
  },
  cloud_unavailable: {
    kind: "gate",
    text: "Firmen-WhatsApp (Cloud API) ist noch nicht konfiguriert. Bitte „WhatsApp öffnen“ nutzen — Versand über Ihr Gerät.",
  },
  failed: {
    kind: "gate",
    text: "WhatsApp-Versand fehlgeschlagen. Bitte später erneut versuchen.",
  },
  no_phone: {
    kind: "gate",
    text: "Keine Telefonnummer hinterlegt — WhatsApp nicht möglich.",
  },
  no_consent: {
    kind: "gate",
    text: "Kein WhatsApp-Opt-in vorhanden — Versand blockiert.",
  },
  must_claim: {
    kind: "gate",
    text: "Bitte übernehmen Sie den Lead vor dieser Aktion.",
  },
  forbidden: {
    kind: "gate",
    text: "Für diese Aufgabe fehlt Ihnen die Berechtigung.",
  },
  not_applicable: {
    kind: "gate",
    text: "Aufgabe eignet sich nicht für WhatsApp.",
  },
  no_template: {
    kind: "gate",
    text: "Für diesen Aufgabentyp ist keine Nachrichtenvorlage hinterlegt — es wurde nichts versendet.",
  },
};

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{
    link?: string;
    taskId?: string;
    revoked?: string;
    wa?: string;
    access?: "must_claim" | "forbidden";
  }>;
}) {
  const session = await getSession();
  if (!session) redirect("/auth/sign-in");

  const t = await getTranslations("tasks");
  const whatsappMode = resolveAdapterMode("whatsapp");
  const waLabels: TaskWhatsAppLabels = {
    send: t("whatsapp.send"),
    opening: t("whatsapp.opening"),
    opened: t("whatsapp.opened"),
    open: t("whatsapp.open"),
    errors: {
      no_phone: t("whatsapp.errors.no_phone"),
      not_applicable: t("whatsapp.errors.not_applicable"),
      must_claim: "Bitte übernehmen Sie den Lead vor dieser Aktion.",
      forbidden: "Für diese Aufgabe fehlt Ihnen die Berechtigung.",
      no_template: WA_BANNER.no_template.text,
      failed: t("whatsapp.errors.failed"),
    },
  };
  const { link, revoked, access, wa } = await searchParams;
  const waBanner = wa ? WA_BANNER[wa] : undefined;
  const revokedMessage =
    revoked === undefined
      ? undefined
      : Number(revoked) > 0
        ? `Aufgaben-Link widerrufen (${Number(revoked)}). Der alte Link ist ab sofort ungültig.`
        : "Kein aktiver Link zum Widerrufen vorhanden.";
  const openTasks = await withTenant(session.tenantId, (tx) =>
    listOpenTasks(tx, { userId: session.id, role: session.role }),
  );

  return (
    <>
      <header className="page-header">
        <h1>{t("title")}</h1>
        <p>{t("subtitle")}</p>
        <HelpLink topic="magic-link" label="Hilfe: Magic Links & WhatsApp" />
      </header>

      {revokedMessage ? (
        <p
          className={Number(revoked) > 0 ? "info-banner" : "gate-banner"}
          style={{ marginBottom: "var(--space-6)" }}
        >
          {revokedMessage}
        </p>
      ) : null}

      {waBanner ? (
        <p
          className={waBanner.kind === "info" ? "info-banner" : "gate-banner"}
          role={waBanner.kind === "gate" ? "alert" : "status"}
          style={{ marginBottom: "var(--space-6)" }}
        >
          {waBanner.text}
        </p>
      ) : null}

      {access ? (
        <p
          className="gate-banner"
          role="alert"
          style={{ marginBottom: "var(--space-6)" }}
        >
          {access === "must_claim"
            ? "Bitte übernehmen Sie den nicht zugewiesenen Lead, bevor Sie diese Aufgabe bearbeiten."
            : "Sie dürfen diese Aufgabe nicht bearbeiten."}
        </p>
      ) : null}

      {session.role === "consultant" ? (
        <p className="info-banner" style={{ marginBottom: "var(--space-6)" }}>
          Reine Arbeitgeber-Aufgaben werden ausschließlich von Teamleitung oder
          Administration bearbeitet.
        </p>
      ) : null}

      {link ? <TaskLinkBanner link={link} /> : null}

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
                  <TaskWhatsAppButton
                    taskId={task.id}
                    mode={whatsappMode}
                    labels={waLabels}
                  />
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
