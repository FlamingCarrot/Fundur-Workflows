"use client";

import React from "react";
import Link from "next/link";
import { ArrowRight, Coffee, Plus, Hourglass } from "lucide-react";
import { useStudio } from "@/components/providers/StudioProvider";
import { ProgressRing, Swatch, WhenReady, swatchVar, CURRENT_USER } from "@/components/ui/primitives";
import { byAttention, nextStep, phaseProgress, upcomingSteps } from "@/lib/studio/selectors";
import { greeting, longToday, relativeDue, relativeTime } from "@/lib/studio/format";
import { getPhase } from "@/lib/workflow";
import type { Project } from "@/lib/studio/types";

const numberWords = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven"];

export function TodayView() {
  const { projects, ready } = useStudio();
  const active = projects.filter((p) => p.status === "active").sort(byAttention);
  const mine = active.filter((p) => p.waitingOn === "me");
  const theirs = active.filter((p) => p.waitingOn === "client");
  const [focus, ...alsoMine] = mine;
  const upcoming = upcomingSteps(active).slice(0, 6);

  const headline =
    mine.length === 0
      ? "Nothing needs you right now."
      : `${numberWords[mine.length] ?? mine.length} project${mine.length > 1 ? "s" : ""} need${mine.length > 1 ? "" : "s"} you today.`;

  return (
    <main className="page">
      <WhenReady ready={ready}>
        <header className="rise" style={{ marginBottom: "2.5rem" }}>
          <p className="eyebrow" style={{ marginBottom: "0.9rem" }}>{longToday()}</p>
          <h1 className="display-xl">
            {greeting()}, {CURRENT_USER.firstName}.
            <br />
            <em>{headline}</em>
          </h1>
        </header>

        {focus ? <FocusCard project={focus} /> : <AllClear />}

        {alsoMine.length > 0 && (
          <section className="rise" style={{ ["--i" as string]: 3, marginTop: "3rem" }}>
            <div className="section-title">
              <h2>
                Also waiting on you<span className="count">{alsoMine.length}</span>
              </h2>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "1rem" }}>
              {alsoMine.map((p) => (
                <MiniProjectCard key={p.id} project={p} />
              ))}
            </div>
          </section>
        )}

        <div
          className="rise"
          style={{
            ["--i" as string]: 4,
            marginTop: "3rem",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
            gap: "2rem",
            alignItems: "start",
          }}
        >
          <section>
            <div className="section-title">
              <h2>Coming up</h2>
              <span className="tiny muted">Across all projects</span>
            </div>
            <div className="card checklist">
              {upcoming.length === 0 && <p className="small muted" style={{ padding: "1.25rem" }}>No dated steps ahead.</p>}
              {upcoming.map(({ project, item, due }) => {
                const d = relativeDue(due);
                return (
                  <Link
                    key={`${project.id}-${item.id}`}
                    href={`/projects/${project.id}/phases/${project.currentPhase}`}
                    className="check-row"
                    style={{ gridTemplateColumns: "auto minmax(0,1fr) auto" }}
                  >
                    <Swatch swatch={project.swatch} />
                    <span className="stack" style={{ minWidth: 0 }}>
                      <span className="small strong truncate">{item.text}</span>
                      <span className="tiny muted truncate">{project.name}</span>
                    </span>
                    <span className={`tiny strong due-${d.tone}`}>{d.text.replace("Due ", "")}</span>
                  </Link>
                );
              })}
            </div>
          </section>

          <section>
            <div className="section-title">
              <h2>
                Waiting on others<span className="count">{theirs.length}</span>
              </h2>
            </div>
            <div className="card checklist">
              {theirs.length === 0 && (
                <p className="small muted" style={{ padding: "1.25rem" }}>Nothing is out with clients.</p>
              )}
              {theirs.map((p) => (
                <Link key={p.id} href={`/projects/${p.id}`} className="check-row">
                  <span className="dropzone-icon" style={{ width: 34, height: 34, borderRadius: "var(--r-sm)", margin: 0, background: "var(--info-soft)", color: "var(--info)" }}>
                    <Hourglass size={16} />
                  </span>
                  <span className="stack" style={{ minWidth: 0 }}>
                    <span className="small strong truncate">{p.name}</span>
                    <span className="tiny muted truncate">
                      {getPhase(p, p.currentPhase)?.name} · updated {relativeTime(p.lastActivity)}
                    </span>
                  </span>
                  <ArrowRight size={16} color="var(--ink-4)" />
                </Link>
              ))}
            </div>
          </section>
        </div>
      </WhenReady>
    </main>
  );
}

function FocusCard({ project }: { project: Project }) {
  const phase = getPhase(project, project.currentPhase);
  const step = nextStep(project);
  const progress = phaseProgress(project, project.currentPhase);
  const due = step.due ? relativeDue(step.due) : null;

  return (
    <Link
      href={`/projects/${project.id}/phases/${project.currentPhase}`}
      className="card card-link hero rise"
      style={{
        ...swatchVar(project.swatch),
        ["--i" as string]: 1,
        padding: "clamp(1.5rem, 3vw, 2.5rem)",
      }}
    >
      <div className="row-between" style={{ alignItems: "flex-start", gap: "2rem", flexWrap: "wrap" }}>
        <div className="stack grow" style={{ gap: "1.25rem", minWidth: 260 }}>
          <div className="row" style={{ gap: "0.6rem" }}>
            <span className="tag tag-me tag-dot">Your next step</span>
            {due && <span className={`tiny strong due-${due.tone}`}>{due.text}</span>}
          </div>
          <h2 className="display-l" style={{ maxWidth: "20ch" }}>
            {step.kind === "item" ? step.item?.text : `Wrap up ${phase?.name}`}
          </h2>
          <div className="row" style={{ gap: "0.6rem" }}>
            <Swatch swatch={project.swatch} />
            <span className="small strong">{project.name}</span>
            <span className="small muted">· {phase?.name}</span>
          </div>
        </div>
        <div className="focus-card-side">
          <ProgressRing
            value={progress.total ? progress.done / progress.total : 0}
            size={84}
            stroke={6}
            color="var(--swatch)"
            label={
              <span className="stack" style={{ alignItems: "center", lineHeight: 1.1 }}>
                <span style={{ fontSize: "1.1rem" }}>{progress.done}/{progress.total}</span>
                <span className="tiny muted" style={{ fontWeight: 500 }}>steps</span>
              </span>
            }
          />
          <span className="btn btn-accent btn-lg">
            Continue <ArrowRight size={18} />
          </span>
        </div>
      </div>
    </Link>
  );
}

function MiniProjectCard({ project }: { project: Project }) {
  const step = nextStep(project);
  const phase = getPhase(project, project.currentPhase);
  const due = step.due ? relativeDue(step.due) : null;
  return (
    <Link href={`/projects/${project.id}/phases/${project.currentPhase}`} className="card card-link" style={{ padding: "1.25rem" }}>
      <div className="row" style={{ gap: "0.55rem", marginBottom: "0.9rem" }}>
        <Swatch swatch={project.swatch} />
        <span className="small strong truncate grow">{project.name}</span>
        <ArrowRight size={15} color="var(--ink-4)" />
      </div>
      <p className="eyebrow" style={{ marginBottom: "0.35rem" }}>{phase?.name}</p>
      <p style={{ fontWeight: 550, lineHeight: 1.35, minHeight: "2.7em" }}>
        {step.kind === "item" ? step.item?.text : "Ready to complete this phase"}
      </p>
      {due && <p className={`tiny strong due-${due.tone}`} style={{ marginTop: "0.6rem" }}>{due.text}</p>}
    </Link>
  );
}

function AllClear() {
  return (
    <div className="card rise" style={{ ["--i" as string]: 1, padding: "2.5rem", textAlign: "center" }}>
      <span className="dropzone-icon" style={{ margin: "0 auto 1rem" }}>
        <Coffee size={22} />
      </span>
      <h2 className="display-m" style={{ marginBottom: "0.5rem" }}>You&apos;re all caught up.</h2>
      <p className="muted" style={{ marginBottom: "1.5rem" }}>Every active project is waiting on someone else.</p>
      <Link href="/projects/new" className="btn btn-primary">
        <Plus size={16} /> Start a project
      </Link>
    </div>
  );
}

