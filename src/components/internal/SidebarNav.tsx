"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface NavItem {
  href: string;
  label: string;
  openInNewTab?: boolean;
}

export function SidebarNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Hauptnavigation">
      {items.map((item) => {
        if (item.openInNewTab) {
          return (
            <a
              key={item.href}
              href={item.href}
              className="nav-link"
              target="_blank"
              rel="noopener noreferrer"
            >
              {item.label}
              <span className="sr-only"> (öffnet in neuem Tab)</span>
            </a>
          );
        }
        const active =
          pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            className="nav-link"
            aria-current={active ? "page" : undefined}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
