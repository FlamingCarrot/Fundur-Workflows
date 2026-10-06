"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Check, Plus, Trash2, FileText, CalendarDays } from "lucide-react";
import { useStudio } from "@/components/providers/StudioProvider";
import { Swatch, WhenReady } from "@/components/ui/primitives";
import { DUE_GROUP_LABEL, dayToDate, groupByDue, openTasks, projectTasks, toDay, type ProjectTask } from "@/lib/studio/tasks";
import { relativeDue, shortDate } from "@/lib/studio/format";
import { getWorkflow } from "@/lib/workflow";
import type { Project } from "@/lib/studio/types";

/**
 * Everything due across the projects (P2-07), with her own tasks beside the
 * workflow's steps (P2-01, P2-02) and the document each one produced (P2-03).
 */
export function TasksView() {
  const { projects, ready } = useStudio();
  const [showDone, setShowDone] = useState(false);
  const active = projects.filter((p) => p.status === "active");
  const open = openTasks(active);
  const groups = groupByDue(open);
  const done = active.flatMap((p) => projectTasks(p).filter((t) => t.done).map((t) => ({ ...t, project: p })));

  return (
    <main className="page">
      <WhenReady ready={ready}>
        <header className="rise" style={{ marginBottom: "2rem" }}>
          <p className="eyebrow" style={{ marginBottom: "0.75rem" }}>Across every project</p>
          <h1 className="display-l">Due list</h1>
          <p className="muted" style={{ marginTop: "0.75rem" }}>
            Every phase step and every task you added, soonest first. Ticking one here ticks it on its phase.
          </p>
        </header>

        <AddTask projects={active} />

        {open.length === 0 && (
          <p className="muted rise" style={{ ["--i" as string]: 2 }}>Nothing is open. Everything is ticked off.</p>
        )}

        {groups.map(({ group, tasks }, i) => (
          <section key={group} className="rise" style={{ ["--i" as string]: i + 2, marginTop: "2rem" }}>
            <div className="section-title">
              <h2>
                {DUE_GROUP_LABEL[group]}
                <span className="count">{tasks.length}</span>
              </h2>
            </div>
            <div className="card checklist">
              {tasks.map((task) => (
                <TaskRow key={`${task.projectId}-${task.id}`} task={task} />
              ))}
            </div>
          </section>
        ))}

        {done.length > 0 && (
          <section className="rise" style={{ marginTop: "2.5rem" }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowDone((v) => !v)}>
              {showDone ? "Hide" : "Show"} {done.length} done
            </button>
            {showDone && (
              <div className="card checklist" style={{ marginTop: "1rem" }}>
                {done.map((task) => (
                  <TaskRow key={`${task.projectId}-${task.id}`} task={task} />
                ))}
              </div>
            )}
          </section>
        )}
      </WhenReady>
    </main>
  );
}

function TaskRow({ task }: { task: ProjectTask }) {
  const { setCheck, updateTask, deleteTask } = useStudio();
  const project = task.project;
  const document = task.outputDocumentId ? project.documents.find((d) => d.id === task.outputDocumentId) : undefined;
  const due = task.due ? relativeDue(dayToDate(task.due)) : null;
  const phaseName = getWorkflow(project).phases.find((p) => p.key === task.phaseKey)?.name ?? task.phaseKey;

  const toggle = () => {
    if (task.source === "step") void setCheck(project.id, task.id, !task.done);
    else updateTask(project.id, task.id, { done: !task.done });
  };

  return (
    <div className="check-row" style={{ gridTemplateColumns: "auto minmax(0,1fr) auto", cursor: "default" }}>
      <button
        type="button"
        role="checkbox"
        aria-checked={task.done}
        aria-label={task.done ? `Mark "${task.title}" as not done` : `Mark "${task.title}" done`}
        className="check-box"
        onClick={toggle}
      >
        <Check size={15} strokeWidth={3} />
      </button>
      <span className="stack" style={{ minWidth: 0, gap: "0.2rem" }}>
        <span className="check-text">{task.title}</span>
        <span className="check-meta row wrap" style={{ gap: "0.4rem" }}>
          <Link href={`/projects/${project.id}/phases/${task.phaseKey}`} className="row" style={{ gap: "0.35rem" }}>
            <Swatch swatch={project.swatch} />
            <span className="strong" style={{ color: "var(--ink-2)" }}>{project.name}</span>
            <span className="muted">· {phaseName}</span>
          </Link>
          {task.source === "own" && <span className="muted">· yours</span>}
          {document && (
            <Link href={`/projects/${project.id}/documents`} className="row muted" style={{ gap: "0.25rem" }}>
              <FileText size={12} /> {document.name}
            </Link>
          )}
        </span>
      </span>
      <span className="row" style={{ gap: "0.5rem" }}>
        {due && !task.done && <span className={`tiny strong due-${due.tone}`}>{due.text.replace("Due ", "")}</span>}
        {task.due && task.done && <span className="tiny muted">{shortDate(dayToDate(task.due))}</span>}
        {task.source === "own" && (
          <button
            type="button"
            className="icon-btn"
            aria-label={`Delete "${task.title}"`}
            onClick={() => deleteTask(project.id, task.id)}
          >
            <Trash2 size={15} />
          </button>
        )}
      </span>
    </div>
  );
}

function AddTask({ projects }: { projects: Project[] }) {
  const { addTask, toast } = useStudio();
  const [open, setOpen] = useState(false);
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [due, setDue] = useState(toDay(new Date()));

  const project = projects.find((p) => p.id === projectId) ?? projects[0];
  if (!project) return null;

  if (!open) {
    return (
      <button type="button" className="btn btn-primary rise" style={{ ["--i" as string]: 1 }} onClick={() => setOpen(true)}>
        <Plus size={16} /> Add a task
      </button>
    );
  }

  return (
    <form
      className="card rise"
      style={{ ["--i" as string]: 1, padding: "1.25rem 1.4rem", display: "grid", gap: "0.85rem" }}
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim()) return;
        // It belongs to the phase the project is on, which is where its work sits.
        addTask(project.id, { phaseKey: project.currentPhase, title: title.trim(), due: due || undefined });
        toast("Task added");
        setTitle("");
        setOpen(false);
      }}
    >
      <input
        className="input"
        autoFocus
        placeholder="What needs doing?"
        value={title}
        maxLength={500}
        onChange={(e) => setTitle(e.target.value)}
      />
      <div className="row wrap" style={{ gap: "0.75rem" }}>
        <label className="field grow" style={{ minWidth: 180 }}>
          <span className="field-label">Project</span>
          <select className="input" value={project.id} onChange={(e) => setProjectId(e.target.value)}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
        <label className="field" style={{ minWidth: 170 }}>
          <span className="field-label row" style={{ gap: "0.35rem" }}>
            <CalendarDays size={13} /> Due
          </span>
          <input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </label>
      </div>
      <div className="row" style={{ justifyContent: "flex-end", gap: "0.5rem" }}>
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={!title.trim()}>Add task</button>
      </div>
    </form>
  );
}
