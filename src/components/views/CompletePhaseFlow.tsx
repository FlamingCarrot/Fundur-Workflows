"use client";

import React, { useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, CornerDownRight, History, Lock } from "lucide-react";
import { useStudio } from "@/components/providers/StudioProvider";
import { FocusFrame } from "@/components/shell/FocusFrame";
import { WhenReady, swatchVar } from "@/components/ui/primitives";
import { MissingProject } from "./MissingProject";
import { phaseProgress, phaseState } from "@/lib/studio/selectors";
import { getWorkflow, handoffFrom } from "@/lib/workflow";
import type { PhaseDefinition } from "@/lib/workflow/schema";
import type { Project } from "@/lib/studio/types";

export function CompletePhaseFlow({ projectId, phaseKey }: { projectId: string; phaseKey: string }) {
  const { ready, getProject } = useStudio();
  const project = getProject(projectId);
  const phase = project ? getWorkflow(project.workflowId).phases.find((p) => p.key === phaseKey) : undefined;
  if (ready && (!project || !phase)) return <main className="page"><MissingProject /></main>;
  return <WhenReady ready={ready}>{project && phase && <Gate project={project} phase={phase} />}</WhenReady>;
}

function Gate({ project, phase }: { project: Project; phase: PhaseDefinition }) {
  const { completePhase } = useStudio();
  const [justCompleted, setJustCompleted] = useState(false);
  const phases = getWorkflow(project.workflowId).phases;
  const idx = phases.indexOf(phase);
  const next = phases[idx + 1];
  const progress = phaseProgress(project, phase.key);
  const handoff = handoffFrom(project.workflowId, phase.key);
  const phaseDocs = project.documents.filter((d) => d.phaseKey === phase.key).length;
  const phaseHref = `/projects/${project.id}/phases/${phase.key}`;
  const state = phaseState(project, phase.key);

  if (justCompleted) return <Celebration project={project} phase={phase} next={next} />;

  if (state !== "current" || !progress.ready) {
    const left = progress.items.filter((i) => i.essential && !project.checks[i.id]);
    return (
      <div style={swatchVar(project.swatch)}>
        <FocusFrame exitHref={phaseHref} title={phase.name}>
          <div className="rise" style={{ textAlign: "center" }}>
            <span className="dropzone-icon" style={{ margin: "0 auto 1.25rem" }}><Lock size={22} /></span>
            <h1 className="display-m" style={{ marginBottom: "0.75rem" }}>
              {state === "complete" ? `${phase.name} is already complete.` : "Not quite ready yet."}
            </h1>
            {state === "current" && (
              <p className="muted" style={{ marginBottom: "1.75rem" }}>
                {left.length} essential step{left.length > 1 ? "s" : ""} still open: {left.map((i) => i.text).join("; ")}.
              </p>
            )}
            <Link href={phaseHref} className="btn btn-primary" style={{ marginTop: "1rem" }}>
              <ArrowLeft size={16} /> Back to {phase.name}
            </Link>
          </div>
        </FocusFrame>
      </div>
    );
  }

  return (
    <div style={swatchVar(project.swatch)}>
      <FocusFrame
        exitHref={phaseHref}
        exitLabel={`Back to ${phase.name}`}
        title={project.name}
        footer={
          <>
            <Link href={phaseHref} className="btn btn-ghost">
              <ArrowLeft size={16} /> Not yet
            </Link>
            <button
              type="button"
              className="btn btn-accent btn-lg"
              onClick={() => {
                completePhase(project.id, phase.key);
                setJustCompleted(true);
              }}
            >
              {next ? `Complete and open ${next.name}` : "Complete project"} <ArrowRight size={17} />
            </button>
          </>
        }
      >
        <div className="rise">
          <p className="eyebrow" style={{ marginBottom: "1rem" }}>Phase {idx + 1} of {phases.length}</p>
          <h1 className="display-l" style={{ marginBottom: "2.5rem" }}>
            Ready to close<br />
            <em>{phase.name}?</em>
          </h1>
        </div>

        <section className="rise" style={{ ["--i" as string]: 1, marginBottom: "2rem" }}>
          <div className="section-title"><h2>What you did</h2></div>
          <div className="card checklist">
            {progress.items.map((item) => {
              const done = !!project.checks[item.id];
              return (
                <div key={item.id} className="check-row" aria-checked={done} style={{ cursor: "default" }}>
                  <span className="check-box"><Check size={15} strokeWidth={3} /></span>
                  <span className="check-text" style={{ textDecoration: "none", color: done ? "var(--ink)" : "var(--ink-3)" }}>
                    {item.text}
                    {!done && <span className="tiny muted"> · optional, skipped</span>}
                  </span>
                  <span />
                </div>
              );
            })}
          </div>
        </section>

        {next && (
          <section className="rise" style={{ ["--i" as string]: 2, marginBottom: "2rem" }}>
            <div className="section-title"><h2>What carries forward</h2></div>
            <div className="card" style={{ padding: "1.25rem 1.35rem" }}>
              <div className="row" style={{ gap: "0.85rem", alignItems: "flex-start" }}>
                <span className="fact-icon" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
                  <CornerDownRight size={16} />
                </span>
                <div className="stack" style={{ gap: "0.2rem" }}>
                  <span className="small strong">Into {next.name}</span>
                  <span className="small muted">{handoff?.description ?? "This phase's documents and notes."}</span>
                </div>
              </div>
            </div>
          </section>
        )}

        <p className="small muted row rise" style={{ ["--i" as string]: 3, gap: "0.5rem" }}>
          <History size={15} /> A snapshot of {phaseDocs} document{phaseDocs === 1 ? "" : "s"} is saved, so you can roll back any time.
        </p>
      </FocusFrame>
    </div>
  );
}

function Celebration({ project, phase, next }: { project: Project; phase: PhaseDefinition; next?: PhaseDefinition }) {
  return (
    <div style={swatchVar(project.swatch)}>
      <FocusFrame exitHref={`/projects/${project.id}`} exitLabel="Back to project" title={project.name}>
        <div style={{ textAlign: "center", paddingTop: "3vh" }}>
          <div className="celebrate" aria-hidden>
            <span className="celebrate-ring" />
            <span className="celebrate-check"><Check size={40} strokeWidth={2.75} /></span>
          </div>
          <p className="eyebrow rise" style={{ ["--i" as string]: 2, margin: "2rem 0 0.9rem" }}>{phase.name} · complete</p>
          <h1 className="display-l rise" style={{ ["--i" as string]: 3, marginBottom: "0.85rem" }}>
            {next ? <>Nicely done.<br /><em>{next.name} is open.</em></> : <>That&apos;s a wrap.<br /><em>Every phase is complete.</em></>}
          </h1>
          <p className="muted rise" style={{ ["--i" as string]: 4, marginBottom: "2.25rem" }}>
            {next ? next.description : "Everything stays here for the handover and for reference."}
          </p>
          <div className="row rise" style={{ ["--i" as string]: 5, justifyContent: "center", flexWrap: "wrap" }}>
            <Link href={`/projects/${project.id}`} className="btn btn-secondary btn-lg">Back to project</Link>
            {next && (
              <Link href={`/projects/${project.id}/phases/${next.key}`} className="btn btn-accent btn-lg">
                Start {next.name} <ArrowRight size={17} />
              </Link>
            )}
          </div>
        </div>
      </FocusFrame>
    </div>
  );
}
