"use client";

import React, { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { X, LifeBuoy, ArrowLeft, Pencil } from "lucide-react";
import { useStudio } from "@/components/providers/StudioProvider";
import { MODULE_REGISTRY, parseModuleRef } from "@/lib/modules/registry";
import { getPhase, label } from "@/lib/workflow";
import { relativeTime } from "@/lib/studio/format";
import { isActiveIssue, type IssueReport, type IssueStatus, type Project } from "@/lib/studio/types";

export function projectIdFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/projects\/([^/]+)/);
  return m && m[1] !== "new" ? m[1] : null;
}

function guessModule(pathname: string): string {
  if (pathname.includes("/brief")) return "structured_form";
  if (pathname.includes("/documents")) return "documents";
  if (pathname.includes("/phases/")) return "checklist";
  return "phase_bar";
}

/** A module's name in the project's own words where it has them, e.g. its brief. */
export function moduleName(key: string, project?: Project, variant?: string): string {
  const fallback = MODULE_REGISTRY[key]?.name ?? key;
  if (project && variant) return label(project, variant, fallback);
  if (project && key === "structured_form") return label(project, "brief", fallback);
  return fallback;
}

export const ISSUE_STATUS_LABEL: Record<IssueStatus, string> = {
  open: "Open",
  in_progress: "Being looked at",
  resolved: "Resolved",
  closed: "Closed",
};

export const ISSUE_STATUS_TAG: Record<IssueStatus, string> = {
  open: "tag-hold",
  in_progress: "tag-client",
  resolved: "tag-good",
  closed: "tag-ai",
};

function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
}

export function IssueSheet() {
  const { issueSheet, setIssueSheetOpen, showMyIssues } = useStudio();
  const close = useCallback(() => setIssueSheetOpen(false), [setIssueSheetOpen]);
  useEscape(close);
  if (!issueSheet) return null;

  return (
    <>
      <div className="scrim" onClick={close} />
      <div className="sheet sheet-scroll" role="dialog" aria-label={issueSheet.mode === "report" ? "Report an issue" : "Your reports"}>
        <div className="row-between" style={{ marginBottom: "1.25rem" }}>
          {issueSheet.mode === "mine" ? (
            <button type="button" className="back-link" onClick={() => setIssueSheetOpen(true)}>
              <ArrowLeft size={15} /> New report
            </button>
          ) : (
            <span className="dropzone-icon" style={{ width: 44, height: 44, margin: 0 }}>
              <LifeBuoy size={20} />
            </span>
          )}
          <button type="button" className="icon-btn" onClick={close} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        {issueSheet.mode === "report" ? (
          <NewReport onDone={close} onShowMine={() => showMyIssues()} />
        ) : (
          <MyReports moduleKey={issueSheet.moduleKey} projectId={issueSheet.projectId} />
        )}
      </div>
    </>
  );
}

function NewReport({ onDone, onShowMine }: { onDone: () => void; onShowMine: () => void }) {
  const { reportIssue, toast, getProject, issues } = useStudio();
  const pathname = usePathname();
  const [moduleKey, setModuleKey] = useState(() => guessModule(pathname));
  const [note, setNote] = useState("");

  // Offer the modules that exist on screen: the working ones, plus whatever the open phase shows.
  const projectId = projectIdFromPath(pathname);
  const project = projectId ? getProject(projectId) : undefined;
  const phaseKey = pathname.match(/\/phases\/([^/]+)/)?.[1];
  const phaseRefs = project && phaseKey ? getPhase(project, phaseKey)?.modules ?? [] : [];
  const onPhase = new Set(phaseRefs.map((r) => parseModuleRef(r).key));
  const modules = Object.values(MODULE_REGISTRY).filter(
    (m) => m.key !== "report_issue" && (m.status === "available" || onPhase.has(m.key))
  );
  const variantOf = (key: string) => phaseRefs.map(parseModuleRef).find((r) => r.key === key)?.variant;
  const mine = issues.filter(isActiveIssue).length;

  return (
    <>
      <h2 className="display-s" style={{ marginBottom: "0.35rem" }}>Something not right?</h2>
      <p className="small muted" style={{ marginBottom: "1.4rem" }}>
        Tell us where it happened. It&apos;s saved against the part you pick, with this page and the time, and a red
        marker stays there so you can find it again.
      </p>
      <span className="eyebrow">Where</span>
      <div className="row wrap" style={{ gap: "0.45rem", margin: "0.6rem 0 1.25rem" }}>
        {modules.map((m) => (
          <button
            key={m.key}
            type="button"
            className="chip"
            aria-pressed={moduleKey === m.key}
            onClick={() => setModuleKey(m.key)}
          >
            {moduleName(m.key, project, variantOf(m.key))}
          </button>
        ))}
      </div>
      <textarea
        className="textarea"
        rows={4}
        autoFocus
        placeholder="What happened, and what did you expect?"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="row-between wrap" style={{ marginTop: "1.25rem", gap: "0.75rem" }}>
        {mine > 0 ? (
          <button type="button" className="btn btn-ghost" onClick={onShowMine}>
            Your open reports <span className="issue-count">{mine}</span>
          </button>
        ) : (
          <span />
        )}
        <div className="row" style={{ gap: "0.5rem" }}>
          <button type="button" className="btn btn-ghost" onClick={onDone}>Cancel</button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!note.trim()}
            onClick={() => {
              reportIssue({ moduleKey, note: note.trim(), projectId: projectId ?? undefined });
              onDone();
              toast("Thanks, your report is in the queue");
            }}
          >
            Send report
          </button>
        </div>
      </div>
    </>
  );
}

function MyReports({ moduleKey, projectId }: { moduleKey?: string; projectId?: string }) {
  const { issues, getProject } = useStudio();
  const project = projectId ? getProject(projectId) : undefined;
  const shown = issues.filter(
    (i) => (!moduleKey || i.moduleKey === moduleKey) && (!moduleKey || (i.projectId ?? null) === (projectId ?? null))
  );
  const title = moduleKey ? `Your reports on ${moduleName(moduleKey, project)}` : "Your reports";

  return (
    <>
      <h2 className="display-s" style={{ marginBottom: "0.35rem" }}>{title}</h2>
      <p className="small muted" style={{ marginBottom: "1.25rem" }}>
        Edit a note to add detail, or close it once it no longer applies.
      </p>
      {shown.length === 0 ? (
        <p className="small muted">Nothing open here.</p>
      ) : (
        <div className="stack" style={{ gap: "0.75rem" }}>
          {shown.map((issue) => (
            <MyReport key={issue.id} issue={issue} showWhere={!moduleKey} />
          ))}
        </div>
      )}
    </>
  );
}

function MyReport({ issue, showWhere }: { issue: IssueReport; showWhere: boolean }) {
  const { editIssue, closeIssue, getProject } = useStudio();
  const [draft, setDraft] = useState<string | null>(null);
  const project = issue.projectId ? getProject(issue.projectId) : undefined;

  return (
    <div className="card" style={{ padding: "1rem 1.1rem" }}>
      <div className="row-between wrap" style={{ gap: "0.5rem", marginBottom: "0.5rem" }}>
        <span className="tiny muted">
          {showWhere && (
            <>
              <span className="strong" style={{ color: "var(--ink-2)" }}>{moduleName(issue.moduleKey, project)}</span>
              {project ? ` in ${project.name}` : ""} ·{" "}
            </>
          )}
          {relativeTime(issue.createdAt)}
        </span>
        <span className={`tag ${ISSUE_STATUS_TAG[issue.status]}`}>{ISSUE_STATUS_LABEL[issue.status]}</span>
      </div>
      {draft === null ? (
        <p className="small" style={{ whiteSpace: "pre-wrap" }}>{issue.note}</p>
      ) : (
        <textarea className="textarea" rows={3} autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} />
      )}
      {issue.adminNote && (
        <p className="small" style={{ marginTop: "0.6rem", paddingLeft: "0.75rem", borderLeft: "2px solid var(--line)" }}>
          <span className="tiny strong muted">Reply · </span>
          {issue.adminNote}
        </p>
      )}
      <div className="row" style={{ justifyContent: "flex-end", gap: "0.4rem", marginTop: "0.75rem" }}>
        {draft === null ? (
          <>
            {isActiveIssue(issue) && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDraft(issue.note)}>
                <Pencil size={13} /> Edit
              </button>
            )}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => closeIssue(issue.id)}>
              {isActiveIssue(issue) ? "Close" : "Dismiss"}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDraft(null)}>Cancel</button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!draft.trim() || draft.trim() === issue.note}
              onClick={() => {
                editIssue(issue.id, draft.trim());
                setDraft(null);
              }}
            >
              Save
            </button>
          </>
        )}
      </div>
    </div>
  );
}
