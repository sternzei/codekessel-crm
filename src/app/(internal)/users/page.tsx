import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { withTenant } from "@/db/client";
import {
  canAssignUserRole,
  canManageUsers,
  canMutateExistingUser,
} from "@/modules/auth/authorization";
import { getSession } from "@/modules/auth/session";
import {
  createUser,
  resetUserPassword,
  setUserActive,
  setUserRole,
} from "@/modules/users/actions";
import { listTenantUsers } from "@/modules/users/queries";

export const dynamic = "force-dynamic";

const BANNER_KEYS = [
  "created",
  "updated",
  "passwordReset",
  "forbidden",
  "exists",
  "invalid",
] as const;

type BannerKey = (typeof BANNER_KEYS)[number];

const isBannerKey = (value: string | undefined): value is BannerKey =>
  !!value && (BANNER_KEYS as readonly string[]).includes(value);

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ result?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/auth/sign-in");
  if (!canManageUsers(session.role)) redirect("/pipeline");

  const t = await getTranslations("users");
  const { result } = await searchParams;
  const banner = isBannerKey(result) ? result : undefined;

  const rows = await withTenant(session.tenantId, (tx) => listTenantUsers(tx));
  const canCreateAdmin =
    canAssignUserRole({ actorRole: session.role, targetRole: "admin" }) ===
    "allowed";

  return (
    <>
      <header className="page-header">
        <h1>{t("title")}</h1>
        <p>{t("subtitle")}</p>
      </header>

      {banner ? (
        <p
          className={
            banner === "forbidden" || banner === "exists" || banner === "invalid"
              ? "gate-banner"
              : "info-banner"
          }
          style={{ marginBottom: "var(--space-6)" }}
          role="status"
        >
          {t(`banners.${banner}`)}
        </p>
      ) : null}

      <section className="card" style={{ marginBottom: "var(--space-6)" }}>
        <h2 style={{ marginBottom: "var(--space-4)" }}>{t("create")}</h2>
        <form action={createUser} className="section-stack">
          <div className="field">
            <label htmlFor="user-name">{t("name")}</label>
            <input
              id="user-name"
              name="name"
              type="text"
              required
              autoComplete="name"
              maxLength={120}
            />
          </div>
          <div className="field">
            <label htmlFor="user-email">{t("email")}</label>
            <input
              id="user-email"
              name="email"
              type="email"
              required
              autoComplete="email"
              maxLength={254}
            />
          </div>
          <div className="field">
            <label htmlFor="user-role">{t("role")}</label>
            <select id="user-role" name="role" defaultValue="consultant" required>
              <option value="consultant">{t("roles.consultant")}</option>
              <option value="manager">{t("roles.manager")}</option>
              {canCreateAdmin ? (
                <option value="admin">{t("roles.admin")}</option>
              ) : null}
            </select>
          </div>
          <div className="field">
            <label htmlFor="user-password">{t("password")}</label>
            <input
              id="user-password"
              name="password"
              type="text"
              required
              minLength={8}
              maxLength={200}
              autoComplete="new-password"
            />
          </div>
          <button type="submit" className="button" aria-label={t("create")}>
            {t("create")}
          </button>
        </form>
      </section>

      <div className="data-list">
        {rows.length === 0 ? (
          <p className="empty-state">{t("empty")}</p>
        ) : (
          rows.map((user) => {
            const isSelf = user.id === session.id;
            const canMutate =
              canMutateExistingUser({
                actorRole: session.role,
                currentRole: user.role,
              }) === "allowed";
            const roleOptions = (
              ["consultant", "manager", "admin"] as const
            ).filter(
              (role) =>
                canAssignUserRole({
                  actorRole: session.role,
                  targetRole: role,
                }) === "allowed" || role === user.role,
            );

            return (
              <article
                key={user.id}
                className="data-row"
                style={{ gridTemplateColumns: "1fr", gap: "var(--space-3)" }}
              >
                <div>
                  <div className="title">{user.name}</div>
                  <div className="meta">
                    {user.email} · {t(`roles.${user.role}`)} ·{" "}
                    {user.active ? t("active") : t("inactive")}
                  </div>
                </div>

                {canMutate ? (
                  <div
                    className="inline-form"
                    style={{ flexWrap: "wrap", gap: "var(--space-2)" }}
                  >
                    {!isSelf ? (
                      <form action={setUserRole} className="inline-form">
                        <input type="hidden" name="userId" value={user.id} />
                        <select
                          id={`role-${user.id}`}
                          name="role"
                          defaultValue={user.role}
                          aria-label={t("role")}
                        >
                          {roleOptions.map((role) => (
                            <option key={role} value={role}>
                              {t(`roles.${role}`)}
                            </option>
                          ))}
                        </select>
                        <button
                          type="submit"
                          className="button button--sm button--ghost"
                        >
                          {t("role")}
                        </button>
                      </form>
                    ) : null}

                    {!isSelf ? (
                      <form action={setUserActive}>
                        <input type="hidden" name="userId" value={user.id} />
                        <input
                          type="hidden"
                          name="active"
                          value={user.active ? "false" : "true"}
                        />
                        <button
                          type="submit"
                          className="button button--sm button--ghost"
                          aria-label={
                            user.active ? t("deactivate") : t("activate")
                          }
                        >
                          {user.active ? t("deactivate") : t("activate")}
                        </button>
                      </form>
                    ) : null}

                    <form action={resetUserPassword} className="inline-form">
                      <input type="hidden" name="userId" value={user.id} />
                      <input
                        id={`pw-${user.id}`}
                        name="password"
                        type="text"
                        required
                        minLength={8}
                        maxLength={200}
                        placeholder={t("password")}
                        aria-label={t("password")}
                      />
                      <button
                        type="submit"
                        className="button button--sm button--ghost"
                      >
                        {t("resetPassword")}
                      </button>
                    </form>
                  </div>
                ) : (
                  <p className="meta" style={{ margin: 0 }}>
                    {t("banners.forbidden")}
                  </p>
                )}
              </article>
            );
          })
        )}
      </div>
    </>
  );
}
