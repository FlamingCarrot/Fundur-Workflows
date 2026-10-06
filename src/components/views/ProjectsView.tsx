"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Plus, FolderOpen } from "lucide-react";
import { useStudio } from "@/components/providers/StudioProvider";
import { PhaseTrack, StatusTag, Swatch, WhenReady, swatchVar } from "@/components/ui/primitives";
import { byAttention, nextStep, phaseIndex } from "@/lib/studio/selectors";
import { relativeTime } from "@/lib/studio/format";
import { getPhase, getWorkflow } from "@/lib/workflow";
import type { Project } from "@/lib/studio/types";

type Filter = "active" | "on_hold" | "complete";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "active", label: "Active" },
  { key: "on_hold", label: "On hold" },
  { key: "complete", label: "Complete" },
];

export function ProjectsView() {
  const { projects, ready, setWaitingOn } = useStudio();
  const [filter, setFilter] = useState<Filter>("active");
  const shown = projects.filter((p) => p.status === filter).sort(byAttention);
  const counts = (f: Filter) => projects.filter((p) => p.status === f).length;

  return (
    <main className="page">
      <WhenReady ready={ready}>
        <header className="row-between rise wrap" style={{ marginBottom: "2rem", alignItems: "flex-end" }}>
          <div>
            <p className="eyebrow" style={{ marginBottom: "0.75rem" }}>
              {counts("active")} active · {counts("on_hold")} on hold
            </p>
            <h1 className="display-l">Projects</h1>
          </div>
          <Link href="/projects/new" className="btn btn-primary">
            <Plus size={16} /> New project
          </Link>
        </header>

        <div className="segmented rise" style={{ ["--i" as string]: 1, marginBottom: "1.75rem" }} role="group" aria-label="Filter projects">
          {FILTERS.map((f) => (
            <button key={f.key} type="button" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>
              {f.label}
            </button>
          ))}
        </div>

        {shown.length === 0 ? (
          <div className="card" style={{ padding: "3rem 1.5rem", textAlign: "center" }}>
            <span className="dropzone-icon" style={{ margin: "0 auto 1rem" }}>
              <FolderOpen size={22} />
            </span>
            <h2 className="display-s" style={{ marginBottom: "0.4rem" }}>
              {filter === "active" ? "No active projects yet" : `Nothing ${filter === "on_hold" ? "on hold" : "complete"}`}
            </h2>
            <p className="small muted">
              {filter === "active" ? "Start one and it will run through every phase with you." : "Projects show up here when their status changes."}
            </p>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "1.1rem" }}>
            {shown.map((p, i) => (
              <ProjectCard key={p.id} project={p} index={i} onToggle={(w) => setWaitingOn(p.id, w)} />
            ))}
          </div>
        )}
      </WhenReady>
    </main>
  );
}

function ProjectCard({ project, index, onToggle }: { project: Project; index: number; onToggle: Parameters<typeof StatusTag>[0]["onToggle"] }) {
  const phases = getWorkflow(project).phases;
  const phase = getPhase(project, project.currentPhase);
  const step = nextStep(project);
  return (
    <Link
      href={`/projects/${project.id}`}
      className="card card-link rise"
      style={{ ...swatchVar(project.swatch), ["--i" as string]: index + 2, padding: 0, overflow: "hidden" }}
    >
      <div className="sample" aria-hidden />
      <div style={{ padding: "1.15rem 1.25rem 1.3rem" }}>
        <div className="row-between" style={{ marginBottom: "0.2rem", alignItems: "flex-start" }}>
          <h3 style={{ fontSize: "1.05rem", fontWeight: 600, letterSpacing: "-0.01em", lineHeight: 1.3 }}>{project.name}</h3>
        </div>
        <p className="small muted" style={{ marginBottom: "1.1rem" }}>{project.client}</p>

        <div className="row-between tiny" style={{ marginBottom: "0.5rem" }}>
          <span className="strong">
            {project.status === "complete" ? "All phases complete" : phase?.name}
          </span>
          <span className="muted tabular">
            {Math.min(phaseIndex(project) + 1, phases.length)} of {phases.length}
          </span>
        </div>
        <PhaseTrack project={project} />

        {project.status === "active" && step.kind !== "done" && (
          <p className="small" style={{ marginTop: "1rem", color: "var(--ink-2)", lineHeight: 1.4 }}>
            <span className="muted">Next · </span>
            {step.kind === "item" ? step.item?.text : "Ready to complete this phase"}
          </p>
        )}

        <div className="row-between" style={{ marginTop: "1.1rem" }}>
          <StatusTag project={project} onToggle={project.status === "active" ? onToggle : undefined} />
          <span className="tiny muted row" style={{ gap: "0.35rem" }}>
            <Swatch swatch={project.swatch} /> {relativeTime(project.lastActivity)}
          </span>
        </div>
      </div>
    </Link>
  );
}
