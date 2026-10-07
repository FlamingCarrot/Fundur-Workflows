"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sun, LayoutGrid, ListChecks, CalendarDays, GanttChart, Plus, Search, Sparkles, LifeBuoy, Settings, LogOut, SlidersHorizontal, Lightbulb } from "lucide-react";
import { useStudio } from "@/components/providers/StudioProvider";
import { Swatch, initials } from "@/components/ui/primitives";
import { byAttention } from "@/lib/studio/selectors";
import { dueGroup, openTasks } from "@/lib/studio/tasks";
import { WorkspaceSwitcher } from "@/components/workspaces/WorkspaceSwitcher";
import { isActiveIssue } from "@/lib/studio/types";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { projects, ready, viewer, issues, setAssistantOpen, setIssueSheetOpen, setSearchOpen } = useStudio();
  const openIssues = issues.filter(isActiveIssue).length;
  const active = projects.filter((p) => p.status === "active").sort(byAttention);
  const needsMe = active.filter((p) => p.waitingOn === "me").length;
  // Everything overdue or due today, across projects.
  const dueToday = ready ? openTasks(active).filter((t) => ["overdue", "today"].includes(dueGroup(t))).length : 0;

  // ⌘K (or Ctrl+K) opens search from anywhere.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setSearchOpen]);

  const isToday = pathname === "/";
  const isProjects = pathname === "/projects";

  return (
    <div className="shell">
      <aside className="sidebar">
        <Link href="/" className="brand" aria-label="Fundur home">
          <span className="brand-mark">f</span>
          Fundur
        </Link>

        <button type="button" className="nav-item nav-search" onClick={() => setSearchOpen(true)}>
          <Search size={17} />
          <span className="nav-text" style={{ textAlign: "left" }}>Search</span>
          <kbd className="tiny muted">⌘K</kbd>
        </button>

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
          <Link href="/timeline" className="nav-item" aria-current={pathname === "/timeline" ? "page" : undefined}>
            <GanttChart size={17} />
            <span className="nav-text">Timeline</span>
          </Link>
          <Link href="/projects" className="nav-item" aria-current={isProjects ? "page" : undefined}>
            <LayoutGrid size={17} />
            <span className="nav-text">All projects</span>
          </Link>
          {viewer.features?.layout !== false && <Link href="/rules" className="nav-item" aria-current={pathname === "/rules" ? "page" : undefined}>
            <SlidersHorizontal size={17} />
            <span className="nav-text">Layout rules</span>
          </Link>}
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
          {(!viewer.workspaceRole || viewer.workspaceRole === "owner") && <Link href="/projects/new" className="nav-item">
            <Plus size={16} />
            <span className="nav-text">New project</span>
          </Link>}
        </nav>

        <div className="sidebar-footer">
          <WorkspaceSwitcher />
          {!viewer.isAdmin && viewer.workspaceRole === "owner" && <Link href="/settings/workspace" className="nav-item"><Settings size={17}/><span className="nav-text">Workspace</span></Link>}
          {viewer.isAdmin && (
            <Link href="/settings/improve" className="nav-item" aria-current={pathname === "/settings/improve" ? "page" : undefined}>
              <Lightbulb size={17} />
              <span className="nav-text">Improve next</span>
            </Link>
          )}
          {viewer.isAdmin && (
            <Link href="/settings" className="nav-item" aria-current={pathname.startsWith("/settings") && pathname !== "/settings/improve" ? "page" : undefined}>
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
            <button type="button" className="icon-btn" aria-label="Search" onClick={() => setSearchOpen(true)}>
              <Search size={18} />
            </button>
            <button type="button" className="icon-btn" aria-label="Report an issue" onClick={() => setIssueSheetOpen(true)}>
              <LifeBuoy size={18} />
            </button>
            {(viewer.isAdmin || viewer.workspaceRole === "owner") && (
              <Link href={viewer.isAdmin ? "/settings" : "/settings/workspace"} className="icon-btn" aria-label="Settings">
                <Settings size={18} />
              </Link>
            )}
            <span className="avatar">{initials(viewer.name)}</span>
          </div>
        </header>

        {viewer.workspaces && viewer.workspaces.length > 1 && <div className="show-sm"><WorkspaceSwitcher /></div>}
        {children}

        {viewer.features?.ai !== false && viewer.workspaceRole !== "collaborator" && <button type="button" className="fab" onClick={() => setAssistantOpen(true)}>
          <Sparkles size={17} />
          Ask Fundur
        </button>}

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
          {(!viewer.workspaceRole || viewer.workspaceRole === "owner") && <Link href="/projects/new">
            <Plus size={20} />
            New
          </Link>}
          {viewer.features?.ai !== false && viewer.workspaceRole !== "collaborator" && <button type="button" onClick={() => setAssistantOpen(true)}>
            <Sparkles size={20} />
            Ask
          </button>}
        </nav>
      </div>
    </div>
  );
}
