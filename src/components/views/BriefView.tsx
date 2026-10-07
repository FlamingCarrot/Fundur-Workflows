"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, Wand2, RefreshCw, Sparkles, AlertCircle, ArrowRight, History, RotateCcw, X } from "lucide-react";
import { useStudio } from "@/components/providers/StudioProvider";
import { IssueMarker } from "@/components/ui/IssueMarker";
import { FocusFrame } from "@/components/shell/FocusFrame";
import { DesignLink } from "@/components/design/DesignLink";
import { WhenReady, swatchVar } from "@/components/ui/primitives";
import { MissingProject } from "./MissingProject";
import { useAutoSave } from "@/hooks/useAutoSave";
import { useProjectChannel } from "@/hooks/useProjectChannel";
import { getForm, getPhase, label, phaseWithForm } from "@/lib/workflow";
import { relativeTime, zar } from "@/lib/studio/format";
import type { FormField } from "@/lib/workflow/schema";
import type { Brief, Project } from "@/lib/studio/types";

/** The brief's fields, as the project's workflow defines them. */
export function briefFields(project: Project): FormField[] {
  return getForm(project, "brief")?.fields ?? [];
}

export function BriefView({ projectId }: { projectId: string }) {
  const { ready, getProject, viewer } = useStudio();
  const project = getProject(projectId);
  if (ready && !project) return <main className="page"><MissingProject /></main>;
  return (
    <WhenReady ready={ready}>{project && <BriefEditor key={`${viewer.userId}.${viewer.workspaceId}.${project.id}`} project={project} />}</WhenReady>
  );
}

function BriefEditor({ project }: { project: Project }) {
  const { updateBrief, saveBrief, persistence, viewer } = useStudio();
  const [historyOpen, setHistoryOpen] = useState(false);
  // The brief as collaborators last saw it: sent from here or received from them.
  const sharedRef = useRef<Brief>(project.brief);
  const { broadcast } = useProjectChannel(project.id, {
    onBriefPatch: (patch) => {
      sharedRef.current = { ...sharedRef.current, ...patch };
    },
  });
  const briefPhase = phaseWithForm(project, "brief");
  const fields = briefFields(project);
  const exitHref = `/projects/${project.id}/phases/${briefPhase?.key ?? project.currentPhase}`;
  const briefLabel = label(project, "brief", "Brief");

  const onSave = useCallback(
    async (value: Brief) => {
      // Saved first, so "Saved" means stored; collaborators then get the change live.
      await saveBrief(project.id);
      // Send only what changed here, so a collaborator's unsaved edits in other fields survive.
      const patch: Brief = Object.fromEntries(Object.entries(value).filter(([k, v]) => sharedRef.current[k] !== v));
      if (!Object.keys(patch).length) return;
      sharedRef.current = { ...sharedRef.current, ...patch };
      broadcast("RECORD_AUTOSAVED", patch, briefPhase?.key);
    },
    [broadcast, briefPhase?.key, saveBrief, project.id]
  );
  const { status, flush } = useAutoSave({ value: project.brief, onSave, debounceMs: 800 });

  const filled = fields.filter((f) => project.brief[f.key]?.trim()).length;
  const isEmpty = filled <= 1;
  const aiCount = project.briefAiFields.length;

  return (
    <div style={swatchVar(project.swatch)}>
      <FocusFrame
        beforeExit={flush}
        exitHref={exitHref}
        exitLabel={`Back to ${briefPhase?.name ?? "phase"}`}
        title={project.name}
        right={<SaveState status={status} />}
        footer={
          <>
            <span className="tiny muted">
              {filled} of {fields.length} filled · AI drafting {zar(project.briefCostZar ?? project.aiSpendZar)}
            </span>
            <span className="row" style={{ gap: "0.5rem" }}>
              {persistence === "server" && (
                <button type="button" className="btn btn-ghost" onClick={() => setHistoryOpen(true)}>
                  <History size={16} /> Versions
                </button>
              )}
              <DesignLink flush={flush} href={exitHref} className="btn btn-primary">
                Done <Check size={16} />
              </DesignLink>
            </span>
          </>
        }
      >
        {status === "error" && <div className="card" role="alert" style={{ padding: "1rem", marginBottom: "1rem" }}><p className="small">Your changes could not be saved. Keep this page open and retry when connected.</p><button type="button" className="btn btn-secondary btn-sm" onClick={() => void flush()}>Retry save</button></div>}
        {historyOpen && <BriefHistory project={project} fields={fields} onClose={() => setHistoryOpen(false)} />}
        <header className="rise" style={{ marginBottom: "2.5rem" }}>
          <p className="eyebrow" style={{ marginBottom: "0.85rem" }}>{briefPhase?.name}</p>
          <h1 className="display-l row" style={{ marginBottom: "0.75rem", gap: "0.75rem" }}>
            {briefLabel}
            <IssueMarker moduleKey="structured_form" projectId={project.id} />
          </h1>
          <p className="lede">Everything later phases build on. Changes save as you type.</p>
        </header>

        {isEmpty && viewer.features?.ai !== false && viewer.workspaceRole !== "collaborator" ? (
          <Link
            href={`/projects/${project.id}/brief/draft`}
            className="card card-link rise"
            style={{
              ["--i" as string]: 1,
              display: "flex",
              alignItems: "center",
              gap: "1.25rem",
              padding: "1.5rem",
              marginBottom: "2.5rem",
              background: "linear-gradient(120deg, var(--accent-soft), var(--surface) 70%)",
            }}
          >
            <span className="dropzone-icon" style={{ margin: 0, background: "var(--accent-fill)", color: "var(--accent-fill-ink)" }}>
              <Wand2 size={22} />
            </span>
            <span className="stack grow" style={{ gap: "0.2rem" }}>
              <span style={{ fontWeight: 600, fontSize: "1.02rem" }}>Start from your meeting notes</span>
              <span className="small muted">Drop them in and get a first draft to edit, instead of a blank page.</span>
            </span>
            <ArrowRight size={18} />
          </Link>
        ) : aiCount > 0 ? (
          <div
            className="row-between wrap rise"
            style={{ ["--i" as string]: 1, padding: "0.9rem 1.1rem", borderRadius: "var(--r-md)", background: "var(--accent-soft)", marginBottom: "2rem" }}
          >
            <span className="small row" style={{ gap: "0.5rem", color: "var(--accent)" }}>
              <Sparkles size={15} />
              <span>
                <strong>{aiCount} section{aiCount > 1 ? "s are" : " is"} an AI draft.</strong> Edit or confirm before it&apos;s used.
              </span>
            </span>
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              onClick={() => {
                const patch = Object.fromEntries(project.briefAiFields.map((f) => [f, project.brief[f]]));
                updateBrief(project.id, patch, false);
              }}
            >
              <Check size={14} /> Looks right
            </button>
          </div>
        ) : null}

        <div className="card rise" style={{ ["--i" as string]: 2, padding: "0.5rem 1.75rem" }}>
          {fields.map((f) => {
            const isAi = project.briefAiFields.includes(f.key);
            return (
              <div key={f.key} className="doc-field" data-ai={isAi}>
                <label htmlFor={`brief-${f.key}`} className="doc-label">
                  {f.label}
                  {f.hint && <div className="doc-hint">{f.hint}</div>}
                  {isAi && (
                    <span className="tag tag-me" style={{ height: 20, fontSize: "0.66rem", marginTop: "0.45rem" }}>
                      <Sparkles size={10} /> AI draft
                    </span>
                  )}
                </label>
                <textarea
                  id={`brief-${f.key}`}
                  className="doc-input"
                  rows={1}
                  placeholder={f.placeholder}
                  value={project.brief[f.key] ?? ""}
                  onChange={(e) => updateBrief(project.id, { [f.key]: e.target.value })}
                />
              </div>
            );
          })}
        </div>
      </FocusFrame>
    </div>
  );
}

function SaveState({ status }: { status: ReturnType<typeof useAutoSave>["status"] }) {
  const map = {
    saved: { icon: <Check size={13} strokeWidth={2.75} />, text: "Saved", color: "var(--good)" },
    saving: { icon: <RefreshCw size={13} className="spin" />, text: "Saving", color: "var(--ink-3)" },
    dirty: { icon: <RefreshCw size={13} />, text: "Editing", color: "var(--ink-3)" },
    error: { icon: <AlertCircle size={13} />, text: "Not saved", color: "var(--bad)" },
  }[status];
  return (
    <span className="tiny strong row" style={{ gap: "0.35rem", color: map.color }} aria-live="polite">
      {map.icon}
      {map.text}
    </span>
  );
}

interface Snapshot {
  id: string;
  phaseKey: string;
  trigger: string;
  createdAt: string;
  brief: Brief;
}

/**
 * The brief as it stood each time a phase was completed (P1-11), and before
 * any restore. Restoring one brings the whole brief back to that state; the
 * brief as it is now is kept first, so a restore can be undone.
 */
function BriefHistory({ project, fields, onClose }: { project: Project; fields: FormField[]; onClose: () => void }) {
  const { restoreBrief, toast } = useStudio();
  const [snapshots, setSnapshots] = useState<Snapshot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const briefLabel = label(project, "brief", "Brief").toLowerCase();

  useEffect(() => {
    fetch(`/api/projects/${encodeURIComponent(project.id)}/versions`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Couldn't load the versions"))))
      .then(
        (body: { snapshots: Snapshot[] }) => setSnapshots(body.snapshots),
        (err: Error) => setError(err.message)
      );
  }, [project.id]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const title = (s: Snapshot) =>
    s.trigger === "before_restore"
      ? "Before a restore"
      : `When ${getPhase(project, s.phaseKey)?.name ?? s.phaseKey} was completed`;

  const restore = async (s: Snapshot) => {
    if (!window.confirm(`Bring the ${briefLabel} back to how it was ${title(s).toLowerCase()}? The current version is kept.`)) return;
    setBusy(true);
    if (await restoreBrief(project.id, s.id)) {
      toast(`${label(project, "brief", "Brief")} restored`);
      onClose();
    }
    setBusy(false);
  };

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-label="Versions" style={{ maxHeight: "calc(100vh - 48px)", overflowY: "auto" }}>
        <div className="row-between" style={{ marginBottom: "0.75rem" }}>
          <h2 className="display-s">Versions</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <p className="small muted" style={{ marginBottom: "1.25rem" }}>
          A copy of the {briefLabel} is saved each time a phase is completed.
        </p>
        {error && <p className="small" role="alert" style={{ color: "var(--bad)" }}>{error}</p>}
        {!snapshots && !error && <p className="small muted">Loading…</p>}
        {snapshots?.length === 0 && (
          <p className="small muted">No versions yet. The first is saved when you complete a phase.</p>
        )}
        <div className="stack" style={{ gap: "0.75rem" }}>
          {snapshots?.map((s) => {
            const changed = fields.filter((f) => (s.brief[f.key] ?? "") !== (project.brief[f.key] ?? ""));
            const expanded = open === s.id;
            return (
              <div key={s.id} className="card" style={{ padding: "1rem 1.1rem" }}>
                <div className="row-between" style={{ gap: "0.75rem" }}>
                  <button type="button" className="stack" style={{ textAlign: "left", minWidth: 0, gap: "0.15rem" }} onClick={() => setOpen(expanded ? null : s.id)} aria-expanded={expanded}>
                    <span className="small strong">{title(s)}</span>
                    <span className="tiny muted">
                      {relativeTime(s.createdAt)} · {changed.length ? `${changed.length} field${changed.length > 1 ? "s" : ""} differ from now` : "Same as now"}
                    </span>
                  </button>
                  {changed.length > 0 && (
                    <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void restore(s)}>
                      <RotateCcw size={14} /> Restore
                    </button>
                  )}
                </div>
                {expanded && changed.length > 0 && (
                  <dl className="stack" style={{ gap: "0.6rem", marginTop: "0.9rem" }}>
                    {changed.map((f) => (
                      <div key={f.key} className="stack" style={{ gap: "0.1rem" }}>
                        <dt className="eyebrow">{f.label}</dt>
                        <dd className="small">{s.brief[f.key]?.trim() || <em className="muted">Empty</em>}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
