"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Diamond, Sparkles, Trash2, X } from "lucide-react";
import { useStudio } from "@/components/providers/StudioProvider";
import { projectTasks, type Task } from "@/lib/studio/tasks";
import { baselineSlip, taskDays, wouldLoop, type PlanMutation } from "@/lib/studio/schedule";
import { getWorkflow } from "@/lib/workflow";
import { shortDate } from "@/lib/studio/format";
import { dayToDate } from "@/lib/studio/tasks";
import type { Project } from "@/lib/studio/types";

type OnPlan = (mutation: PlanMutation, label: string, inverse?: PlanMutation) => void;

function Sheet({ label, title, onClose, children }: { label: string; title: React.ReactNode; onClose: () => void; children: React.ReactNode }) {
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div
        className="sheet tl-sheet"
        role="dialog"
        aria-label={label}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
      >
        <div className="row-between" style={{ gap: "1rem", marginBottom: "1.1rem" }}>
          <div style={{ minWidth: 0 }}>{title}</div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </>
  );
}

/**
 * One task's plan: its days, whether it is a milestone, its estimate and the
 * tasks it waits on. Everything here is undoable from the timeline.
 */
export function TaskSheet({
  project,
  task,
  onClose,
  onPlan,
  onMove,
  onLink,
}: {
  project: Project;
  task: Task;
  onClose: () => void;
  onPlan: OnPlan;
  onMove: (start: string, due: string) => void;
  onLink: (after: string[]) => void;
}) {
  const { setCheck, updateTask, deleteTask, askAboutTask, toast } = useStudio();
  const [title, setTitle] = useState(task.title);
  const [estimate, setEstimate] = useState(task.estimateHours != null ? String(task.estimateHours) : "");
  const tasks = projectTasks(project);
  const phases = getWorkflow(project).phases;
  const phaseName = phases.find((p) => p.key === task.phaseKey)?.name ?? "";
  const after = task.after ?? [];
  const current = { after, milestone: !!task.milestone, estimateHours: task.estimateHours ?? null };

  const setPlan = (patch: Partial<typeof current>, label: string) =>
    onPlan({ type: "setTaskPlan", taskId: task.id, ...current, ...patch }, label, { type: "setTaskPlan", taskId: task.id, ...current });

  // Tasks it could wait on: not itself, not already linked, and not one that waits on it.
  const candidates = tasks.filter((t) => t.id !== task.id && !after.includes(t.id) && !wouldLoop(project, task.id, [...after, t.id]));

  const saveEstimate = () => {
    const hours = estimate.trim() === "" ? null : Number(estimate);
    if (hours !== null && (!Number.isFinite(hours) || hours < 0)) return setEstimate(current.estimateHours != null ? String(current.estimateHours) : "");
    if (hours === current.estimateHours) return;
    setPlan({ estimateHours: hours }, `Estimate for ${task.title}`);
  };

  return (
    <Sheet
      label={`Plan ${task.title}`}
      onClose={onClose}
      title={
        <>
          <p className="eyebrow truncate" style={{ marginBottom: "0.35rem" }}>{project.name} · {phaseName}</p>
          {task.source === "own" ? (
            <input
              className="input tl-title-input"
              value={title}
              maxLength={500}
              aria-label="Task"
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => title.trim() && title.trim() !== task.title && updateTask(project.id, task.id, { title: title.trim() })}
            />
          ) : (
            <h2 className="display-s">{task.title}</h2>
          )}
        </>
      }
    >
      <div className="tl-sheet-grid">
        <label className="field">
          <span className="field-label">Starts</span>
          <input
            className="input"
            type="date"
            value={task.start ?? ""}
            onChange={(e) => {
              const start = e.target.value;
              if (!start) return;
              const due = task.due && task.due >= start ? task.due : start;
              onMove(start, due);
            }}
          />
        </label>
        <label className="field">
          <span className="field-label">Due</span>
          <input
            className="input"
            type="date"
            value={task.due ?? ""}
            onChange={(e) => {
              const due = e.target.value;
              if (!due) return;
              const start = task.start && task.start <= due ? task.start : due;
              onMove(start, due);
            }}
          />
        </label>
        <label className="field">
          <span className="field-label">Estimate (hours)</span>
          <input
            className="input"
            inputMode="decimal"
            placeholder="1"
            value={estimate}
            onChange={(e) => setEstimate(e.target.value)}
            onBlur={saveEstimate}
            onKeyDown={(e) => e.key === "Enter" && saveEstimate()}
          />
        </label>
      </div>
      {task.start && task.due && (
        <p className="small muted" style={{ marginTop: "0.5rem" }}>
          {taskDays(task) === 1 ? "One day" : `${taskDays(task)} days`}, {shortDate(dayToDate(task.start))}
          {task.start !== task.due ? ` to ${shortDate(dayToDate(task.due))}` : ""}.
        </p>
      )}

      <div className="row wrap" style={{ gap: "0.5rem", marginTop: "1rem" }}>
        <button
          type="button"
          className="chip"
          aria-pressed={task.done}
          onClick={() => {
            if (task.source === "step") void setCheck(project.id, task.id, !task.done);
            else updateTask(project.id, task.id, { done: !task.done });
          }}
        >
          {task.done ? "Done" : "Mark done"}
        </button>
        <button
          type="button"
          className="chip"
          aria-pressed={!!task.milestone}
          onClick={() => setPlan({ milestone: !task.milestone }, `${task.title} as a milestone`)}
          title="A single moment, such as a sign-off or handover"
        >
          <Diamond size={12} /> Milestone
        </button>
      </div>

      <div style={{ marginTop: "1.25rem" }}>
        <p className="field-label" style={{ marginBottom: "0.5rem" }}>Waits on</p>
        {after.length === 0 && <p className="small muted">Nothing. It can start whenever it is scheduled.</p>}
        <div className="tl-links-list">
          {after.map((id) => {
            const other = tasks.find((t) => t.id === id);
            return (
              <span key={id} className="tl-link-chip">
                <span className="truncate small">{other?.title ?? "A removed task"}</span>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Stop waiting on ${other?.title ?? "it"}`}
                  onClick={() => onLink(after.filter((a) => a !== id))}
                >
                  <X size={13} />
                </button>
              </span>
            );
          })}
        </div>
        {candidates.length > 0 && (
          <select
            className="input"
            style={{ marginTop: "0.5rem" }}
            value=""
            aria-label="Add a task it waits on"
            onChange={(e) => {
              if (!e.target.value) return;
              onLink([...after, e.target.value]);
            }}
          >
            <option value="">Add a task it waits on…</option>
            {phases.map((ph) => {
              const options = candidates.filter((t) => t.phaseKey === ph.key);
              if (!options.length) return null;
              return (
                <optgroup key={ph.key} label={ph.name}>
                  {options.map((t) => (
                    <option key={t.id} value={t.id}>{t.title}</option>
                  ))}
                </optgroup>
              );
            })}
          </select>
        )}
      </div>

      <div className="row-between wrap" style={{ marginTop: "1.5rem", gap: "0.5rem" }}>
        <div className="row" style={{ gap: "0.5rem" }}>
          <Link href={`/projects/${project.id}/phases/${task.phaseKey}`} className="btn btn-ghost btn-sm">Open phase</Link>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              askAboutTask({ projectId: project.id, taskId: task.id, title: task.title });
              onClose();
            }}
          >
            <Sparkles size={14} /> Ask Fundur
          </button>
        </div>
        {task.source === "own" && (
          <button
            type="button"
            className="btn btn-ghost btn-sm tl-danger"
            onClick={() => {
              deleteTask(project.id, task.id);
              toast("Task deleted");
              onClose();
            }}
          >
            <Trash2 size={14} /> Delete
          </button>
        )}
      </div>
    </Sheet>
  );
}

/** A whole project's plan: shift it, save or clear its baseline, put its phases back. */
export function ProjectSheet({
  project,
  onClose,
  onShift,
  onPlan,
  onResetPhases,
}: {
  project: Project;
  onClose: () => void;
  onShift: (days: number) => void;
  onPlan: OnPlan;
  onResetPhases: () => void;
}) {
  const { toast } = useStudio();
  const [days, setDays] = useState("7");
  const slip = baselineSlip(project);
  const n = Math.trunc(Number(days));

  return (
    <Sheet
      label={`Plan ${project.name}`}
      onClose={onClose}
      title={
        <>
          <p className="eyebrow" style={{ marginBottom: "0.35rem" }}>{project.client}</p>
          <h2 className="display-s truncate">{project.name}</h2>
        </>
      }
    >
      <section>
        <p className="field-label" style={{ marginBottom: "0.5rem" }}>Shift the whole project</p>
        <p className="small muted" style={{ marginBottom: "0.6rem" }}>Every phase and every date you set moves by the same number of days.</p>
        <div className="row wrap" style={{ gap: "0.5rem" }}>
          <input className="input" style={{ width: 90 }} inputMode="numeric" value={days} aria-label="Days" onChange={(e) => setDays(e.target.value)} />
          <button type="button" className="btn btn-secondary btn-sm" disabled={!n} onClick={() => onShift(-Math.abs(n))}>Earlier</button>
          <button type="button" className="btn btn-secondary btn-sm" disabled={!n} onClick={() => onShift(Math.abs(n))}>Later</button>
        </div>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <p className="field-label" style={{ marginBottom: "0.5rem" }}>Baseline</p>
        <p className="small muted" style={{ marginBottom: "0.6rem" }}>
          {project.baseline
            ? `Saved ${shortDate(new Date(project.baseline.savedAt))}. ${
                slip && slip.endDays !== 0
                  ? `The end has moved ${Math.abs(slip.endDays)} day${Math.abs(slip.endDays) === 1 ? "" : "s"} ${slip.endDays > 0 ? "later" : "earlier"} since.`
                  : "The end has not moved since."
              }`
            : "Save the plan as agreed with the client, then turn on Baseline to see what slipped."}
        </p>
        <div className="row wrap" style={{ gap: "0.5rem" }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => {
              onPlan({ type: "setBaseline", save: true }, "Save baseline");
              toast(project.baseline ? "Baseline updated to today's plan" : "Baseline saved");
            }}
          >
            {project.baseline ? "Update to today's plan" : "Save baseline"}
          </button>
          {project.baseline && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onPlan({ type: "setBaseline", save: false }, "Clear baseline")}>
              Clear
            </button>
          )}
        </div>
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <p className="field-label" style={{ marginBottom: "0.5rem" }}>Phases</p>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onResetPhases}>Put phases back on the workflow&apos;s plan</button>
      </section>
    </Sheet>
  );
}
