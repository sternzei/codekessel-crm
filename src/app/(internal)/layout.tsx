import Image from "next/image";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { SidebarNav } from "@/components/internal/SidebarNav";
import { logout } from "@/modules/auth/actions";
import {
  canManageUsers,
  getRoleLabel,
} from "@/modules/auth/authorization";
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
    // Product policy: OpenRegister import is admin-only; managers are excluded.
    ...(session.role === "admin"
      ? [{ href: "/leads/import", label: "Register-Import" }]
      : []),
    ...(canManageUsers(session.role)
      ? [{ href: "/users", label: t("users") }]
      : []),
    { href: "/hilfe", label: t("help") },
  ];

  return (
    <div className="shell">
      <aside className="sidebar">
        <Link
          href="/pipeline"
          className="sidebar-brand"
          aria-label="CodeKessel – Antragsplattform"
        >
          <span className="sidebar-brand-atmosphere" aria-hidden="true">
            <Image
              src="/brand/codekessel-mark.png"
              alt=""
              width={856}
              height={908}
              className="sidebar-brand-watermark"
              priority
            />
          </span>
          <span className="sidebar-brand-content">
            <Image
              src="/brand/codekessel-wordmark-on-dark.png"
              alt="CodeKessel"
              width={1024}
              height={298}
              className="sidebar-brand-wordmark"
              priority
              unoptimized
            />
            <small className="sidebar-brand-tagline">{tApp("tagline")}</small>
          </span>
        </Link>
        <SidebarNav items={items} />
        <div className="sidebar-footer">
          <div>
            <strong>{session.name}</strong>
            {getRoleLabel(session.role)}
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
