"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/settings", label: "AI models" },
  { href: "/settings/routing", label: "Routing" },
  { href: "/settings/tickets", label: "Tickets" },
  { href: "/settings/plans", label: "Plans" },
];

/** Moves between the Admin's settings pages. */
export function SettingsTabs() {
  const pathname = usePathname();
  return (
    <nav className="segmented rise" aria-label="Admin settings" style={{ marginBottom: "1.75rem" }}>
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className="segmented-link"
          aria-current={pathname === t.href ? "page" : undefined}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
