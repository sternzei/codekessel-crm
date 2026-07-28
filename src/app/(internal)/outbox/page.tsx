import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { HelpLink } from "@/components/help/help-link";
import { withTenant } from "@/db/client";
import { env } from "@/lib/env";
import { canManageTenantRecords } from "@/modules/auth/authorization";
import { getSession } from "@/modules/auth/session";
import {
  listPendingMessages,
  listStaleSendingMessages,
} from "@/modules/messaging/outbox";
import {
  approveMessage,
  cancelMessage,
  rejectMessage,
} from "@/modules/outbox/actions";

export const dynamic = "force-dynamic";

// Only the banners that map to a translation key are surfaced; unknown values
// are ignored so a stray query param never renders a broken banner.
const BANNER_KEYS = new Set([
  "dispatched",
  "failed",
  "rejected",
  "cancelled",
  "not_found",
  "not_pending",
  "not_cancellable",
  "forbidden_role",
  "self_approval",
]);

const SUCCESS_BANNERS = new Set(["queued", "dispatched", "rejected", "cancelled"]);

export default async function OutboxPage({
  searchParams,
}: {
  searchParams: Promise<{ queued?: string; result?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/auth/sign-in");

  const t = await getTranslations("outbox");
  const { queued, result } = await searchParams;

  const bannerKey = queued ? "queued" : result && BANNER_KEYS.has(result) ? result : null;
  const isSuccess = bannerKey ? SUCCESS_BANNERS.has(bannerKey) : false;

  const canModerate = canManageTenantRecords(session.role);
  const { pending, staleSending } = await withTenant(
    session.tenantId,
    async (tx) => ({
      pending: await listPendingMessages(tx, {
        userId: session.id,
        role: session.role,
      }),
      staleSending: canModerate
        ? await listStaleSendingMessages(
            tx,
            env.OUTBOX_STALE_SENDING_MINUTES,
          )
        : [],
    }),
  );
  if (staleSending.length > 0) {
    console.warn(
      JSON.stringify({
        event: "outbox_stale_sending_detected",
        tenantId: session.tenantId,
        thresholdMinutes: env.OUTBOX_STALE_SENDING_MINUTES,
        messageIds: staleSending.map((message) => message.id),
      }),
    );
  }

  return (
    <>
      <header className="page-header">
        <h1>{t("title")}</h1>
        <p>{t("subtitle")}</p>
        {env.WHATSAPP_SENDER_NUMBER ? (
          <p className="meta">
            {t("sender")}: +{env.WHATSAPP_SENDER_NUMBER}
          </p>
        ) : null}
        <HelpLink topic="whatsapp-approval" label="Hilfe: Freigabe & Versand" />
      </header>

      {bannerKey ? (
        <p
          className={isSuccess ? "info-banner" : "gate-banner"}
          style={{ marginBottom: "var(--space-6)" }}
          role="status"
        >
          {t(`banners.${bannerKey}`)}
        </p>
      ) : null}

      {!canModerate ? (
        <p className="info-banner" style={{ marginBottom: "var(--space-6)" }}>
          {t("approvalRestricted")}
        </p>
      ) : null}

      {staleSending.length > 0 ? (
        <p
          className="gate-banner"
          role="alert"
          style={{ marginBottom: "var(--space-6)" }}
        >
          {staleSending.length} Nachricht(en) stehen seit mehr als{" "}
          {env.OUTBOX_STALE_SENDING_MINUTES} Minuten auf „Wird gesendet“.
          Manuelle Abstimmung mit dem Provider erforderlich – nicht blind erneut
          senden.
        </p>
      ) : null}

      {pending.length === 0 ? (
        <div className="empty-state">{t("empty")}</div>
      ) : (
        <div className="data-list">
          {pending.map((message) => (
            <article key={message.id} className="card" style={{ marginBottom: "var(--space-4)" }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: "var(--space-3)",
                  marginBottom: "var(--space-2)",
                }}
              >
                <div>
                  <div className="title">
                    {message.recipientName ?? t(`recipientKind.${message.recipientKind}`)}
                  </div>
                  <div className="meta">
                    {t(`recipientKind.${message.recipientKind}`)}
                    {message.recipientPhone ? ` · ${message.recipientPhone}` : ""}
                    {message.recipientEmail ? ` · ${message.recipientEmail}` : ""}
                  </div>
                </div>
                <span className="badge">{t(`channels.${message.channel}`)}</span>
              </div>

              {message.subject ? (
                <p style={{ fontWeight: 600, marginBottom: "var(--space-1)" }}>
                  {message.subject}
                </p>
              ) : null}
              <p
                className="meta"
                style={{ whiteSpace: "pre-wrap", marginBottom: "var(--space-4)" }}
              >
                {message.body}
              </p>

              <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "flex-end", flexWrap: "wrap" }}>
                {canModerate ? <form action={approveMessage}>
                  <input type="hidden" name="messageId" value={message.id} />
                  <button
                    type="submit"
                    className="button button--sm"
                    aria-label={t("approve")}
                    disabled={message.createdByUserId === session.id}
                    title={
                      message.createdByUserId === session.id
                        ? t("selfApprovalRestricted")
                        : undefined
                    }
                  >
                    {t("approve")}
                  </button>
                </form> : null}
                {canModerate ? <form
                  action={rejectMessage}
                  style={{ display: "flex", gap: "var(--space-2)", alignItems: "flex-end" }}
                >
                  <input type="hidden" name="messageId" value={message.id} />
                  <div className="field">
                    <label htmlFor={`reason-${message.id}`}>{t("reasonLabel")}</label>
                    <input
                      id={`reason-${message.id}`}
                      type="text"
                      name="reason"
                      maxLength={500}
                      placeholder={t("reasonPlaceholder")}
                    />
                  </div>
                  <button
                    type="submit"
                    className="button button--sm button--ghost"
                    aria-label={t("reject")}
                  >
                    {t("reject")}
                  </button>
                </form> : null}
                {canModerate ? (
                  <form action={cancelMessage}>
                    <input type="hidden" name="messageId" value={message.id} />
                    <button
                      type="submit"
                      className="button button--sm button--ghost"
                      aria-label={t("cancel")}
                    >
                      {t("cancel")}
                    </button>
                  </form>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
