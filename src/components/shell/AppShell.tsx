"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sun, LayoutGrid, ListChecks, CalendarDays, Plus, Sparkles, LifeBuoy, Settings, LogOut } from "lucide-react";
import { useStudio } from "@/components/providers/StudioProvider";
import { Swatch, initials } from "@/components/ui/primitives";
import { byAttention } from "@/lib/studio/selectors";
import { dueGroup, openTasks } from "@/lib/studio/tasks";
import { isActiveIssue } from "@/lib/studio/types";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { projects, ready, viewer, issues, setAssistantOpen, setIssueSheetOpen } = useStudio();
  const openIssues = issues.filter(isActiveIssue).length;
  const active = projects.filter((p) => p.status === "active").sort(byAttention);
  const needsMe = active.filter((p) => p.waitingOn === "me").length;
  // Everything overdue or due today, across projects.
  const dueToday = ready ? openTasks(active).filter((t) => ["overdue", "today"].includes(dueGroup(t))).length : 0;

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
          <Link href="/tasks" className="nav-item" aria-current={pathname === "/tasks" ? "page" : undefined}>
            <ListChecks size={17} />
            <span className="nav-text">Due list</span>
            {ready && dueToday > 0 && <span className="nav-badge">{dueToday}</span>}
          </Link>
          <Link href="/calendar" className="nav-item" aria-current={pathname === "/calendar" ? "page" : undefined}>
            <CalendarDays size={17} />
            <span className="nav-text">Calendar</span>
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
          {viewer.isAdmin && (
            <Link href="/settings" className="nav-item" aria-current={pathname.startsWith("/settings") ? "page" : undefined}>
              <Settings size={17} />
              <span className="nav-text">Settings</span>
            </Link>
          )}
          <button type="button" className="nav-item" onClick={() => setIssueSheetOpen(true)}>
            <LifeBuoy size={17} />
            <span className="nav-text" style={{ textAlign: "left" }}>Report an issue</span>
            {openIssues > 0 && (
              <span className="issue-count" title={`${openIssues} of your reports are still open`}>
                {openIssues}
              </span>
            )}
          </button>
          <div className="user-chip">
            <span className="avatar">{initials(viewer.name)}</span>
            <div className="stack grow" style={{ minWidth: 0 }}>
              <span className="small strong truncate">{viewer.name}</span>
              <span className="tiny muted truncate">{viewer.isAdmin ? "Admin" : viewer.workspace}</span>
            </div>
            {viewer.signedIn && (
              // A plain link: the SDK's logout route is a full-page redirect, not a client route.
              <a href="/auth/logout" className="icon-btn" aria-label="Sign out" title="Sign out">
                <LogOut size={16} />
              </a>
            )}
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
            {viewer.isAdmin && (
              <Link href="/settings" className="icon-btn" aria-label="Settings">
                <Settings size={18} />
              </Link>
            )}
            <span className="avatar">{initials(viewer.name)}</span>
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
          <Link href="/tasks" aria-current={pathname === "/tasks" ? "page" : undefined}>
            <ListChecks size={20} />
            Due
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
