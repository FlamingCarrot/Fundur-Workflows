"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sun, LayoutGrid, Plus, Sparkles, LifeBuoy } from "lucide-react";
import { useStudio } from "@/components/providers/StudioProvider";
import { Swatch, initials, CURRENT_USER } from "@/components/ui/primitives";
import { byAttention } from "@/lib/studio/selectors";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { projects, ready, setAssistantOpen, setIssueSheetOpen } = useStudio();
  const active = projects.filter((p) => p.status === "active").sort(byAttention);
  const needsMe = active.filter((p) => p.waitingOn === "me").length;

  const isToday = pathname === "/";
  const isProjects = pathname === "/projects";

  return (
    <div className="shell">
      <aside className="sidebar">
        <Link href="/" className="brand" aria-label="Fundur home">
          <span className="brand-mark">f</span>
          Fundur
        </Link>

        <nav className="nav-group" aria-label="Main">
          <Link href="/" className="nav-item" aria-current={isToday ? "page" : undefined}>
            <Sun size={17} />
            <span className="nav-text">Today</span>
            {ready && needsMe > 0 && <span className="nav-badge">{needsMe}</span>}
          </Link>
          <Link href="/projects" className="nav-item" aria-current={isProjects ? "page" : undefined}>
            <LayoutGrid size={17} />
            <span className="nav-text">All projects</span>
          </Link>
        </nav>

        <nav className="nav-group" aria-label="Active projects">
          <span className="eyebrow nav-label">Active</span>
          {ready &&
            active.slice(0, 6).map((p) => {
              const here = pathname.startsWith(`/projects/${p.id}`);
              return (
                <Link
                  key={p.id}
                  href={`/projects/${p.id}`}
                  className="nav-item"
                  aria-current={here ? "page" : undefined}
                >
                  <Swatch swatch={p.swatch} />
                  <span className="nav-text">{p.name}</span>
                </Link>
              );
            })}
          <Link href="/projects/new" className="nav-item">
            <Plus size={16} />
            <span className="nav-text">New project</span>
          </Link>
        </nav>

        <div className="sidebar-footer">
          <button type="button" className="nav-item" onClick={() => setIssueSheetOpen(true)}>
            <LifeBuoy size={17} />
            <span className="nav-text" style={{ textAlign: "left" }}>Report an issue</span>
          </button>
          <div className="user-chip">
            <span className="avatar">{initials(CURRENT_USER.name)}</span>
            <div className="stack grow">
              <span className="small strong truncate">{CURRENT_USER.name}</span>
              <span className="tiny muted truncate">{CURRENT_USER.workspace}</span>
            </div>
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="mobile-bar">
          <Link href="/" className="brand" style={{ padding: 0, fontSize: "1.35rem" }}>
            <span className="brand-mark">f</span>
            Fundur
          </Link>
          <div className="row" style={{ gap: "0.25rem" }}>
            <button type="button" className="icon-btn" aria-label="Report an issue" onClick={() => setIssueSheetOpen(true)}>
              <LifeBuoy size={18} />
            </button>
            <span className="avatar">{initials(CURRENT_USER.name)}</span>
          </div>
        </header>

        {children}

        <button type="button" className="fab" onClick={() => setAssistantOpen(true)}>
          <Sparkles size={17} />
          Ask Fundur
        </button>

        <nav className="tabbar" aria-label="Main">
          <Link href="/" aria-current={isToday ? "page" : undefined}>
            <Sun size={20} />
            Today
          </Link>
          <Link href="/projects" aria-current={isProjects || pathname.startsWith("/projects/") ? "page" : undefined}>
            <LayoutGrid size={20} />
            Projects
          </Link>
          <Link href="/projects/new">
            <Plus size={20} />
            New
          </Link>
          <button type="button" onClick={() => setAssistantOpen(true)}>
            <Sparkles size={20} />
            Ask
          </button>
        </nav>
      </div>
    </div>
  );
}
