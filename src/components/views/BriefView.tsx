"use client";

import React, { useCallback } from "react";
import Link from "next/link";
import { Check, Wand2, RefreshCw, Sparkles, AlertCircle, ArrowRight } from "lucide-react";
import { useStudio } from "@/components/providers/StudioProvider";
import { FocusFrame } from "@/components/shell/FocusFrame";
import { WhenReady, swatchVar } from "@/components/ui/primitives";
import { MissingProject } from "./MissingProject";
import { useAutoSave } from "@/hooks/useAutoSave";
import { useProjectChannel } from "@/hooks/useProjectChannel";
import { getWorkflow, label } from "@/lib/workflow";
import { zar } from "@/lib/studio/format";
import type { Brief, BriefField, Project } from "@/lib/studio/types";

export const BRIEF_FIELDS: { key: BriefField; label: string; hint?: string; placeholder: string }[] = [
  { key: "clientName", label: "Client", placeholder: "Who the work is for" },
  { key: "headcount", label: "Headcount", hint: "People to seat", placeholder: "e.g. 140" },
  { key: "departments", label: "Departments", hint: "Teams and their sizes", placeholder: "Executive (12), Finance (30)…" },
  { key: "adjacencies", label: "Adjacencies", hint: "Who sits near whom", placeholder: "Finance next to the boardroom…" },
  { key: "targetBudget", label: "Budget", hint: "Fit-out, excl. VAT", placeholder: "R 0" },
  { key: "spaceRequirements", label: "Space", hint: "Area, floors, constraints", placeholder: "2,000 m² over two floors…" },
  { key: "notes", label: "Look and feel", hint: "Materials, mood, must-haves", placeholder: "Warm neutrals, acoustic panelling…" },
];

export function BriefView({ projectId }: { projectId: string }) {
  const { ready, getProject } = useStudio();
  const project = getProject(projectId);
  if (ready && !project) return <main className="page"><MissingProject /></main>;
  return (
    <WhenReady ready={ready}>{project && <BriefEditor project={project} />}</WhenReady>
  );
}

function BriefEditor({ project }: { project: Project }) {
  const { updateBrief } = useStudio();
  const { broadcast } = useProjectChannel(project.id);
  const briefPhase = getWorkflow(project.workflowId).phases.find((p) => p.modules.includes("structured_form:brief"));
  const exitHref = `/projects/${project.id}/phases/${briefPhase?.key ?? project.currentPhase}`;
  const briefLabel = label(project.workflowId, "brief", "Brief");

  const onSave = useCallback(
    async (value: Brief) => {
      // Stand-in for the Neon write; collaborators get the change live.
      await new Promise((r) => setTimeout(r, 350));
      broadcast("RECORD_AUTOSAVED", value, briefPhase?.key);
    },
    [broadcast, briefPhase?.key]
  );
  const { status } = useAutoSave({ value: project.brief, onSave, debounceMs: 800 });

  const filled = BRIEF_FIELDS.filter((f) => project.brief[f.key].trim()).length;
  const isEmpty = filled <= 1;
  const aiCount = project.briefAiFields.length;

  return (
    <div style={swatchVar(project.swatch)}>
      <FocusFrame
        exitHref={exitHref}
        exitLabel={`Back to ${briefPhase?.name ?? "phase"}`}
        title={project.name}
        right={<SaveState status={status} />}
        footer={
          <>
            <span className="tiny muted">
              {filled} of {BRIEF_FIELDS.length} filled · AI spend {zar(project.aiSpendZar)}
            </span>
            <Link href={exitHref} className="btn btn-primary">
              Done <Check size={16} />
            </Link>
          </>
        }
      >
        <header className="rise" style={{ marginBottom: "2.5rem" }}>
          <p className="eyebrow" style={{ marginBottom: "0.85rem" }}>{briefPhase?.name}</p>
          <h1 className="display-l" style={{ marginBottom: "0.75rem" }}>{briefLabel}</h1>
          <p className="lede">Everything later phases build on. Changes save as you type.</p>
        </header>

        {isEmpty ? (
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
          {BRIEF_FIELDS.map((f) => {
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
                  value={project.brief[f.key]}
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
    error: { icon: <AlertCircle size={13} />, text: "Retrying", color: "var(--bad)" },
  }[status];
  return (
    <span className="tiny strong row" style={{ gap: "0.35rem", color: map.color }} aria-live="polite">
      {map.icon}
      {map.text}
    </span>
  );
}
