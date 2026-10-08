"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/settings/improve", label: "Improve next" },
  { href: "/settings/usage", label: "Usage" },
  { href: "/settings", label: "AI models" },
  { href: "/settings/routing", label: "Routing" },
  { href: "/settings/workflows", label: "Workflow pilot" },
  { href: "/settings/tickets", label: "Tickets" },
  { href: "/settings/workspace", label: "Workspace" },
];

/** Moves between the Admin's settings pages. */
export function SettingsTabs() {
  const pathname = usePathname();
  return (
    <nav className="segmented rise" aria-label="Admin settings" style={{ marginBottom: "1.75rem", flexWrap: "wrap" }}>
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
