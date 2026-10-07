"use client";

import React from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, FileText, PenLine, Wallet, CalendarDays, PauseCircle, PlayCircle, CornerDownRight, PartyPopper } from "lucide-react";
import { useStudio } from "@/components/providers/StudioProvider";
import { useProjectChannel } from "@/hooks/useProjectChannel";
import { ProgressRing, StatusTag, Swatch, WhenReady, swatchVar } from "@/components/ui/primitives";
import { MissingProject } from "./MissingProject";
import { nextStep, phaseProgress, phaseState } from "@/lib/studio/selectors";
import { relativeDue, shortDate, zar } from "@/lib/studio/format";
import { getForm, getWorkflow, label } from "@/lib/workflow";
import type { Project } from "@/lib/studio/types";

export function ProjectView({ projectId }: { projectId: string }) {
  const { ready, getProject } = useStudio();
  const project = getProject(projectId);
  return (
    <main className="page">
      <WhenReady ready={ready}>{project ? <ProjectOverview project={project} /> : <MissingProject />}</WhenReady>
    </main>
  );
}

function ProjectOverview({ project }: { project: Project }) {
  const { setStatus, toast, viewer } = useStudio();
  const { changeWaitingOn } = useProjectChannel(project.id);
  const workflow = getWorkflow(project);
  const briefTotal = getForm(project, "brief")?.fields.length ?? 0;
  const briefFilled = (getForm(project, "brief")?.fields ?? []).filter((f) => project.brief[f.key]?.trim()).length;
  const phases = workflow.phases;
  const current = phases.find((p) => p.key === project.currentPhase)!;
  const idx = phases.indexOf(current);
  const progress = phaseProgress(project, current.key);
  const step = nextStep(project);
  const due = step.due ? relativeDue(step.due) : null;
  const isDone = project.status === "complete";

  return (
    <div style={swatchVar(project.swatch)}>
      <Link href="/projects" className="back-link rise" style={{ marginBottom: "2rem" }}>
        <ArrowLeft size={15} /> All projects
      </Link>

      <header className="rise" style={{ ["--i" as string]: 1, marginBottom: "2.5rem" }}>
        <div className="row" style={{ gap: "1rem", marginBottom: "1.25rem" }}>
          <Swatch swatch={project.swatch} size="lg" />
          <div className="stack" style={{ minWidth: 0 }}>
            <span className="eyebrow">{project.client}</span>
            <span className="small muted">{workflow.name} · v{workflow.version}</span>
          </div>
        </div>
        <h1 className="display-l" style={{ marginBottom: "1.1rem" }}>{project.name}</h1>
        <div className="row wrap" style={{ gap: "0.5rem" }}>
          <StatusTag project={project} onToggle={project.status === "active" ? changeWaitingOn : undefined} />
          {project.status === "active" && (!viewer.workspaceRole || viewer.workspaceRole === "owner") && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setStatus(project.id, "on_hold");
                toast(`${project.name} is on hold`);
              }}
            >
              <PauseCircle size={14} /> Put on hold
            </button>
          )}
          {project.status === "on_hold" && (!viewer.workspaceRole || viewer.workspaceRole === "owner") && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setStatus(project.id, "active")}>
              <PlayCircle size={14} /> Resume project
            </button>
          )}
        </div>
      </header>

      <div className="split">
        <div className="stack" style={{ gap: "3rem" }}>
          {/* The one thing to do on this project */}
          {isDone ? (
            <section className="card rise" style={{ ["--i" as string]: 2, padding: "2rem", borderRadius: "var(--r-xl)" }}>
              <span className="dropzone-icon" style={{ marginBottom: "1rem", background: "var(--good-soft)", color: "var(--good)" }}>
                <PartyPopper size={22} />
              </span>
              <h2 className="display-m">Every phase is complete.</h2>
              <p className="muted" style={{ marginTop: "0.5rem" }}>The handover pack and all documents stay here for reference.</p>
            </section>
          ) : (
            <Link
              href={`/projects/${project.id}/phases/${current.key}`}
              className="card card-link hero rise"
              style={{
                ["--i" as string]: 2,
                padding: "clamp(1.4rem, 3vw, 2rem)",
              }}
            >
              <div className="row-between" style={{ alignItems: "flex-start", gap: "1.5rem" }}>
                <div className="stack" style={{ gap: "0.6rem", minWidth: 0 }}>
                  <span className="eyebrow">
                    Now · {label(project, "phase", "Phase")} {idx + 1} of {phases.length}
                  </span>
                  <h2 className="display-m">{current.name}</h2>
                  <p className="muted small" style={{ maxWidth: "52ch" }}>{current.description}</p>
                </div>
                <ProgressRing
                  value={progress.total ? progress.done / progress.total : 0}
                  size={64}
                  stroke={5}
                  color="var(--swatch)"
                  label={`${progress.done}/${progress.total}`}
                />
              </div>
              <hr className="divider" style={{ margin: "1.5rem 0 1.25rem" }} />
              <div className="row-between wrap">
                <div className="stack" style={{ minWidth: 0, gap: "0.15rem" }}>
                  <span className="tiny muted">Next step</span>
                  <span style={{ fontWeight: 550 }}>
                    {step.kind === "item" ? step.item?.text : "All essentials done, ready to complete"}
                  </span>
                  {due && <span className={`tiny strong due-${due.tone}`}>{due.text}</span>}
                </div>
                <span className="btn btn-accent">
                  Open {current.name} <ArrowRight size={16} />
                </span>
              </div>
            </Link>
          )}

          {/* The whole journey, phase by phase */}
          <section className="rise" style={{ ["--i" as string]: 3 }}>
            <div className="section-title">
              <h2>The journey</h2>
              <span className="tiny muted">{project.completedPhases.length} of {phases.length} complete</span>
            </div>
            <ol className="journey">
              {phases.map((ph, i) => {
                const state = phaseState(project, ph.key);
                const pp = phaseProgress(project, ph.key);
                const handoff = workflow.handoffs.find((h) => h.from.split(".")[0] === ph.key);
                return (
                  <li key={ph.key} className="journey-item" data-state={state}>
                    <Link href={`/projects/${project.id}/phases/${ph.key}`} className="journey-link">
                      <span className="journey-marker">{state === "complete" ? <Check size={16} strokeWidth={2.75} /> : i + 1}</span>
                      <div className="journey-body">
                        <div className="row" style={{ gap: "0.6rem" }}>
                          <span className="journey-name">{ph.name}</span>
                          {state === "current" && <span className="tag tag-me" style={{ height: 22 }}>In progress</span>}
                        </div>
                        <p className="small muted" style={{ marginTop: "0.2rem" }}>
                          {state === "complete"
                            ? "Complete"
                            : state === "current"
                              ? `${pp.done} of ${pp.total} steps done`
                              : ph.description}
                        </p>
                        {state === "complete" && handoff?.description && (
                          <div className="handoff">
                            <CornerDownRight size={14} style={{ flexShrink: 0, marginTop: 2 }} />
                            {handoff.description}
                          </div>
                        )}
                      </div>
                      <ArrowRight size={16} color="var(--ink-4)" style={{ marginTop: 10 }} />
                    </Link>
                  </li>
                );
              })}
            </ol>
          </section>
        </div>

        <aside className="rise" style={{ ["--i" as string]: 4 }}>
          <div className="card facts">
            <Link href={`/projects/${project.id}/brief`} className="fact">
              <span className="fact-icon"><PenLine size={16} /></span>
              <span className="stack grow">
                <span className="small strong">{label(project, "brief", "Brief")}</span>
                <span className="tiny muted">
                  {briefFilled ? `${briefFilled} of ${briefTotal} sections filled` : "Not started"}
                </span>
              </span>
              <ArrowRight size={15} color="var(--ink-4)" />
            </Link>
            <Link href={`/projects/${project.id}/documents`} className="fact">
              <span className="fact-icon"><FileText size={16} /></span>
              <span className="stack grow">
                <span className="small strong">Documents</span>
                <span className="tiny muted">
                  {project.documents.length} file{project.documents.length === 1 ? "" : "s"} ·{" "}
                  {project.documents.filter((d) => d.clientVisible).length} eligible for client links
                </span>
              </span>
              <ArrowRight size={15} color="var(--ink-4)" />
            </Link>
            {viewer.workspaceRole !== "collaborator" && <Link href={`/projects/${project.id}/ai`} className="fact">
              <span className="fact-icon"><Wallet size={16} /></span>
              <span className="stack grow">
                <span className="small strong tabular">{zar(project.aiSpendZar)}</span>
                <span className="tiny muted">AI spend on this project</span>
              </span>
              <ArrowRight size={15} color="var(--ink-4)" />
            </Link>}
            <div className="fact">
              <span className="fact-icon"><CalendarDays size={16} /></span>
              <span className="stack grow">
                <span className="small strong">Started {shortDate(new Date(project.startDate))}</span>
                <span className="tiny muted">Dates follow the workflow&apos;s plan</span>
              </span>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
