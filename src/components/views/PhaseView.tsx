"use client";

import React, { useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, CalendarDays, Check, Lock, PenLine, FileText, Sparkles, Hammer, LayoutGrid, Ruler, Wand2 } from "lucide-react";
import { useStudio } from "@/components/providers/StudioProvider";
import { useProjectChannel } from "@/hooks/useProjectChannel";
import { ProgressRing, WhenReady, swatchVar } from "@/components/ui/primitives";
import { MissingProject } from "./MissingProject";
import { ChosenLayoutCard } from "@/components/layout/ChosenLayoutCard";
import { IssueMarker } from "@/components/ui/IssueMarker";
import { phaseProgress, phaseState } from "@/lib/studio/selectors";
import { dayToDate, projectTasks } from "@/lib/studio/tasks";
import { relativeDue, zar } from "@/lib/studio/format";
import { useAiSpend } from "@/hooks/useAiSpend";
import { getForm, getWorkflow, label } from "@/lib/workflow";
import { getRegisteredModule, parseModuleRef } from "@/lib/modules/registry";
import type { ChecklistItem, PhaseDefinition } from "@/lib/workflow/schema";
import type { Project } from "@/lib/studio/types";

export function PhaseView({ projectId, phaseKey }: { projectId: string; phaseKey: string }) {
  const { ready, getProject } = useStudio();
  const project = getProject(projectId);
  const phase = project ? getWorkflow(project).phases.find((p) => p.key === phaseKey) : undefined;
  return (
    <main className="page">
      <WhenReady ready={ready}>
        {project && phase ? <PhaseWorkspace project={project} phase={phase} /> : <MissingProject />}
      </WhenReady>
    </main>
  );
}

function PhaseWorkspace({ project, phase }: { project: Project; phase: PhaseDefinition }) {
  const { setAssistantOpen, viewer } = useStudio();
  const aiEnabled = viewer.features?.ai !== false && viewer.workspaceRole !== "collaborator";
  const { data: spend } = useAiSpend(project.id, project.aiSpendZar);
  const phaseSpend = spend?.costs.byPhase.find((l) => l.key === phase.key)?.zar ?? 0;
  const stepSpend = (id: string) => spend?.costs.byTask.find((l) => l.key === id)?.zar ?? 0;
  const { status, toggleCheck } = useProjectChannel(project.id);
  const phases = getWorkflow(project).phases;
  const idx = phases.indexOf(phase);
  const state = phaseState(project, phase.key);
  const progress = phaseProgress(project, phase.key);
  const editable = state === "current" && project.status === "active";
  const essentialsLeft = progress.items.filter((i) => i.essential && !project.checks[i.id]);
  const previous = phases[idx - 1];
  // A phase that receives the chosen layout shows it, with the reasons, before anything else.
  const layoutHandoff = getWorkflow(project).handoffs.find((h) => h.to.split(".")[0] === phase.key && h.from.endsWith(".chosen_plan"));
  const handsOverLayout = !!layoutHandoff;
  const layoutPhase = layoutHandoff ? phases.find((p) => p.key === layoutHandoff.from.split(".")[0]) : undefined;

  const stateLine =
    state === "complete" ? "Complete" : state === "current" ? "In progress" : `Opens after ${previous?.name ?? "the previous phase"}`;

  return (
    <div style={swatchVar(project.swatch)}>
      <div className="row-between wrap rise" style={{ marginBottom: "2.25rem" }}>
        <Link href={`/projects/${project.id}`} className="back-link">
          <ArrowLeft size={15} /> {project.name}
        </Link>
        <nav className="stepper" aria-label="Phases">
          {phases.map((ph, i) => (
            <React.Fragment key={ph.key}>
              {i > 0 && <span className="stepper-line" aria-hidden />}
              <Link
                href={`/projects/${project.id}/phases/${ph.key}`}
                data-state={phaseState(project, ph.key)}
                aria-current={ph.key === phase.key ? "page" : undefined}
                title={ph.name}
              >
                {phaseState(project, ph.key) === "complete" ? <Check size={13} strokeWidth={3} /> : i + 1}
                <span className="sr-only">{ph.name}</span>
              </Link>
            </React.Fragment>
          ))}
        </nav>
      </div>

      <header className="rise" style={{ ["--i" as string]: 1, marginBottom: "2.5rem" }}>
        <p className="eyebrow row" style={{ gap: "0.5rem", marginBottom: "0.85rem" }}>
          {label(project, "phase", "Phase")} {idx + 1} of {phases.length} · {stateLine}
          {editable && (
            <span className="row" style={{ gap: "0.35rem", textTransform: "none", letterSpacing: 0, fontWeight: 500 }} title="Changes sync live">
              <span className={`live-dot ${status}`} /> {status === "connected" ? "Live" : "Connecting"}
            </span>
          )}
        </p>
        <h1 className="display-l" style={{ marginBottom: "0.75rem" }}>{phase.name}</h1>
        <p className="lede">{phase.description}</p>
        {phaseSpend > 0 && (
          <Link href={`/projects/${project.id}/ai`} className="tiny muted" style={{ display: "inline-block", marginTop: "0.6rem" }}>
            AI spend in this phase: {zar(phaseSpend)}
          </Link>
        )}
      </header>

      {handsOverLayout && viewer.features?.floor_plan !== false && (
        <div style={{ marginBottom: "2.5rem" }}>
          <ChosenLayoutCard projectId={project.id} fromPhase={layoutPhase?.name} />
        </div>
      )}

      <section className="rise" style={{ ["--i" as string]: 2 }}>
        <div className="section-title">
          <h2>
            Steps<span className="count">{progress.done}/{progress.total}</span>
          </h2>
          <IssueMarker moduleKey="checklist" projectId={project.id} />
          {!editable && state !== "complete" && (
            <span className="tiny muted row" style={{ gap: "0.35rem" }}>
              <Lock size={12} /> Not open yet
            </span>
          )}
        </div>
        <div className="card checklist" role="list">
          {progress.items.map((item) => (
            <StepRow
              key={item.id}
              item={item}
              project={project}
              phase={phase}
              editable={editable}
              spendZar={stepSpend(item.id)}
              onToggle={() => toggleCheck(item.id, !project.checks[item.id], phase.key)}
            />
          ))}
        </div>
      </section>

      <section className="rise" style={{ ["--i" as string]: 3, marginTop: "3rem" }}>
        <div className="section-title">
          <h2>Tools for this phase</h2>
        </div>
        <div className="tools">
          {phase.modules
            .filter((m) => m !== "checklist" && !(["canvas_board", "item_register", "regulatory_checklist"].includes(parseModuleRef(m).key) && viewer.features?.design === false) && !(m.startsWith("floor_plan_editor") && viewer.features?.floor_plan === false) && !(m.startsWith("layout_generator") && (viewer.features?.layout === false || viewer.features?.floor_plan === false)))
            .map((m) => (
              <div key={m} className="marker-host" style={{ display: "grid" }}>
                <ToolTile moduleKey={m} project={project} phase={phase} />
                <IssueMarker moduleKey={parseModuleRef(m).key} projectId={project.id} className="pinned" />
              </div>
            ))}
          {(aiEnabled ? phase.ai_actions ?? [] : []).map((a) =>
            a.id === "generate_layout_options" ? null : (
            <button
              key={a.id}
              type="button"
              className="card card-link tool"
              style={{ textAlign: "left" }}
              onClick={() => setAssistantOpen(true)}
            >
              <span className="fact-icon" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
                <Sparkles size={16} />
              </span>
              <span className="stack" style={{ gap: "0.25rem" }}>
                <span className="small strong">{a.name}</span>
                <span className="tiny muted">{a.description}</span>
              </span>
            </button>
            )
          )}
        </div>
      </section>

      {editable && (
        <div className="gate-bar" data-ready={progress.ready}>
          <ProgressRing
            value={progress.essentialTotal ? progress.essentialDone / progress.essentialTotal : 0}
            size={44}
            stroke={4}
            color={progress.ready ? "var(--good)" : "var(--swatch)"}
            label={progress.ready ? <Check size={16} strokeWidth={3} color="var(--good)" /> : `${progress.essentialDone}/${progress.essentialTotal}`}
          />
          <div className="stack grow" style={{ minWidth: 0 }}>
            <span className="small strong">
              {progress.ready ? "Ready to complete" : `${essentialsLeft.length} essential${essentialsLeft.length > 1 ? "s" : ""} to go`}
            </span>
            <span className="tiny muted truncate">
              {progress.ready ? `Next up: ${phases[idx + 1]?.name ?? "handover"}` : essentialsLeft[0]?.text}
            </span>
          </div>
          {aiEnabled && <button type="button" className="icon-btn" aria-label="Ask Fundur" title="Ask Fundur" onClick={() => setAssistantOpen(true)}>
            <Sparkles size={18} />
          </button>}
          {progress.ready ? (
            <Link href={`/projects/${project.id}/phases/${phase.key}/complete`} className="btn btn-accent">
              <span>Complete<span className="hide-sm"> phase</span></span> <ArrowRight size={16} />
            </Link>
          ) : (
            <button type="button" className="btn btn-secondary" disabled>
              <Lock size={14} /> <span>Complete<span className="hide-sm"> phase</span></span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * One checklist step. It is also a task (P2-01): its date can be moved off the
 * workflow's own, and it can carry the document it produced (P2-03).
 */
function StepRow({
  item,
  project,
  phase,
  editable,
  spendZar,
  onToggle,
}: {
  item: ChecklistItem;
  project: Project;
  phase: PhaseDefinition;
  editable: boolean;
  /** AI spend on work asked from this step. */
  spendZar: number;
  onToggle: () => void;
}) {
  const { setStepDue, setStepOutput, askAboutTask, viewer } = useStudio();
  const [editing, setEditing] = useState(false);
  const task = projectTasks(project).find((t) => t.id === item.id)!;
  const done = task.done;
  const d = task.due && !done ? relativeDue(dayToDate(task.due)) : null;
  const output = task.outputDocumentId ? project.documents.find((doc) => doc.id === task.outputDocumentId) : undefined;
  const phaseDocuments = project.documents.filter((doc) => doc.phaseKey === phase.key);

  return (
    <div className="stack" style={{ gap: 0 }}>
      <div className="check-row" style={{ gridTemplateColumns: "auto minmax(0,1fr) auto" }}>
        <button
          type="button"
          role="checkbox"
          aria-checked={done}
          aria-label={done ? `Mark "${item.text}" as not done` : `Mark "${item.text}" done`}
          className="check-box"
          disabled={!editable}
          style={{ cursor: editable ? "pointer" : "default" }}
          onClick={onToggle}
        >
          <Check size={15} strokeWidth={3} />
        </button>
        <span className="stack" style={{ minWidth: 0 }}>
          <span className="check-text">{item.text}</span>
          <span className="check-meta row wrap" style={{ gap: "0.35rem" }}>
            {item.essential ? (
              <span className="strong" style={{ color: done ? "var(--ink-3)" : "var(--ink-2)" }}>Essential</span>
            ) : (
              <span className="muted">Optional</span>
            )}
            {d && <span className={`strong due-${d.tone}`}>· {d.text}</span>}
            {task.dateMoved && <span className="muted">· date moved</span>}
            {spendZar > 0 && <span className="muted">· AI {zar(spendZar)}</span>}
            {output && (
              <Link href={`/projects/${project.id}/documents`} className="row muted" style={{ gap: "0.25rem" }}>
                <FileText size={12} /> {output.name}
              </Link>
            )}
          </span>
        </span>
        {editable && (
          <span className="row" style={{ gap: "0.15rem" }}>
          {viewer.features?.ai !== false && viewer.workspaceRole !== "collaborator" && <button
            type="button"
            className="icon-btn"
            aria-label={`Ask Fundur about "${item.text}"`}
            title="Ask Fundur about this step"
            onClick={() => askAboutTask({ projectId: project.id, taskId: item.id, title: item.text })}
          >
            <Sparkles size={16} />
          </button>}
          <button
            type="button"
            className="icon-btn"
            aria-label={`Date and output for "${item.text}"`}
            aria-expanded={editing}
            onClick={() => setEditing((v) => !v)}
          >
            <CalendarDays size={16} />
          </button>
          </span>
        )}
      </div>
      {editing && (
        <div className="row wrap" style={{ gap: "0.85rem", padding: "0 1.25rem 1.1rem 3.5rem" }}>
          <label className="field" style={{ minWidth: 170 }}>
            <span className="field-label">Due</span>
            <input
              className="input"
              type="date"
              value={task.due ?? ""}
              onChange={(e) => setStepDue(project.id, item.id, phase.key, e.target.value || null)}
            />
          </label>
          <label className="field grow" style={{ minWidth: 200 }}>
            <span className="field-label">What it produces</span>
            <select
              className="input"
              value={task.outputDocumentId ?? ""}
              onChange={(e) => setStepOutput(project.id, item.id, phase.key, e.target.value || null)}
            >
              <option value="">Nothing yet</option>
              {phaseDocuments.map((doc) => (
                <option key={doc.id} value={doc.id}>{doc.name}</option>
              ))}
            </select>
          </label>
        </div>
      )}
    </div>
  );
}

function ToolTile({ moduleKey, project, phase }: { moduleKey: string; project: Project; phase: PhaseDefinition }) {
  const { viewer } = useStudio();
  const { key: base, variant } = parseModuleRef(moduleKey);
  const mod = getRegisteredModule(moduleKey);
  if (base === "regulatory_checklist") return <Link href={`/projects/${project.id}/regulations`} className="card card-link tool"><span className="fact-icon"><Check size={16}/></span><span className="stack"><span className="small strong">Regulation checklist</span><span className="tiny muted">Project requirements, evidence notes and flags to verify</span></span></Link>;

  if (base === "structured_form" && variant === "brief") {
    const fields = getForm(project, "brief")?.fields ?? [];
    const filled = fields.filter((f) => project.brief[f.key]?.trim()).length;
    const total = fields.length;
    return (
      <Link href={`/projects/${project.id}/brief`} className="card card-link tool">
        <span className="fact-icon"><PenLine size={16} /></span>
        <span className="stack grow" style={{ gap: "0.25rem" }}>
          <span className="small strong">{label(project, "brief", "Brief")}</span>
          <span className="tiny muted">{filled} of {total} sections filled</span>
        </span>
        {filled < total && viewer.features?.ai !== false && viewer.workspaceRole !== "collaborator" && phase.ai_actions?.some((a) => a.id === "draft_brief_from_notes") && (
          <span className="tiny strong row" style={{ gap: "0.3rem", color: "var(--accent)" }}>
            <Wand2 size={13} /> Draft it from notes
          </span>
        )}
      </Link>
    );
  }

  if ((base === "canvas_board" || base === "item_register") && variant) return <Link href={`/projects/${project.id}/${base === "canvas_board" ? "boards" : "items"}/${variant}`} className="card card-link tool"><span className="fact-icon"><LayoutGrid size={16}/></span><span className="stack"><span className="small strong">{label(project,variant,mod?.name ?? variant)}</span><span className="tiny muted">{base === "canvas_board" ? "Arrange images, notes and tagged selections" : "Selections that follow the project through every stage"}</span></span></Link>;

  if (base === "sharing" || base === "comments") return <Link href={`/projects/${project.id}/documents#sharing-heading`} className="card card-link tool"><span className="fact-icon"><FileText size={16}/></span><span className="stack"><span className="small strong">{mod?.name}</span><span className="tiny muted">Manage client links and conversations</span></span></Link>;

  if (base === "documents") {
    const count = project.documents.filter((d) => d.phaseKey === phase.key).length;
    return (
      <Link href={`/projects/${project.id}/documents`} className="card card-link tool">
        <span className="fact-icon"><FileText size={16} /></span>
        <span className="stack" style={{ gap: "0.25rem" }}>
          <span className="small strong">Documents</span>
          <span className="tiny muted">{count ? `${count} in this phase` : "Nothing uploaded yet"}</span>
        </span>
      </Link>
    );
  }

  if (base === "layout_generator") {
    return (
      <Link href={`/projects/${project.id}/layout`} className="card card-link tool">
        <span className="fact-icon"><LayoutGrid size={16} /></span>
        <span className="stack" style={{ gap: "0.25rem" }}>
          <span className="small strong">{label(project, "layout_generator", mod?.name ?? base)}</span>
          <span className="tiny muted">Three to five layouts from your rules and the brief, scored side by side</span>
        </span>
      </Link>
    );
  }

  if (base === "floor_plan_editor") {
    return (
      <Link href={`/projects/${project.id}/plan`} className="card card-link tool">
        <span className="fact-icon"><Ruler size={16} /></span>
        <span className="stack" style={{ gap: "0.25rem" }}>
          <span className="small strong">{variant ? label(project, variant, mod?.name ?? base) : mod?.name ?? base}</span>
          <span className="tiny muted">Import or draw the plan, correct its measurements</span>
        </span>
      </Link>
    );
  }

  return (
    <div className="card tool" aria-disabled="true">
      <span className="fact-icon"><Hammer size={16} /></span>
      <span className="stack" style={{ gap: "0.25rem" }}>
        <span className="small strong">{variant ? label(project, variant, mod?.name ?? base) : mod?.name ?? base}</span>
        <span className="tiny muted">Arrives in a later release</span>
      </span>
    </div>
  );
}
