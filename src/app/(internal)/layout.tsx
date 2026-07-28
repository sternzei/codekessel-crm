import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { SidebarNav } from "@/components/internal/SidebarNav";
import { logout } from "@/modules/auth/actions";
import { getSession } from "@/modules/auth/session";

export default async function InternalLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await getSession();
  if (!session) redirect("/auth/sign-in");

  const t = await getTranslations("nav");
  const tApp = await getTranslations("app");

  const items = [
    { href: "/pipeline", label: t("pipeline") },
    { href: "/tasks", label: t("tasks") },
    { href: "/outbox", label: t("outbox") },
    { href: "/appointments", label: t("appointments") },
    { href: "/employers", label: t("employers") },
    { href: "/documents", label: t("documents") },
    { href: "/applications", label: t("applications") },
    { href: "/reports", label: t("reports") },
    // Admin-only: OpenRegister company import.
    ...(session.role === "admin"
      ? [{ href: "/leads/import", label: "Register-Import" }]
      : []),
  ];

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          QCG
          <small>{tApp("name")}</small>
        </div>
        <SidebarNav items={items} />
        <div className="sidebar-footer">
          <div>
            <strong>{session.name}</strong>
            {session.role === "admin" ? "Verwaltung" : "Beratung"}
          </div>
          <form action={logout}>
            <button
              type="submit"
              className="nav-link"
              style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}
            >
              {t("signOut")}
            </button>
          </form>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
