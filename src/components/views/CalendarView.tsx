"use client";

import React, { useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Check, FileText } from "lucide-react";
import { useStudio } from "@/components/providers/StudioProvider";
import { Swatch, WhenReady, swatchVar } from "@/components/ui/primitives";
import {
  addMonths,
  buildWeeks,
  monthName,
  shortMonthName,
  startOfMonth,
  startOfQuarter,
  WEEKDAYS,
  type CalendarWeek,
} from "@/lib/studio/calendar";
import { dayToDate, openTasks, projectTasks, toDay, type ProjectTask } from "@/lib/studio/tasks";
import { shortDate } from "@/lib/studio/format";
import { getWorkflow } from "@/lib/workflow";

type Range = "month" | "quarter";

/**
 * Every project's tasks on the dates they are due (P2-04), in a month or a
 * quarter (P2-05). Switching between them keeps the day that is selected.
 */
export function CalendarView() {
  const { projects, ready } = useStudio();
  const today = toDay(new Date());
  const [range, setRange] = useState<Range>("month");
  const [anchor, setAnchor] = useState(startOfMonth(today));
  const [selected, setSelected] = useState<string | null>(today);

  const active = projects.filter((p) => p.status === "active");
  // Done tasks stay on the calendar: what happened is as useful as what is left.
  const tasks: ProjectTask[] = active.flatMap((p) => projectTasks(p).map((t) => ({ ...t, project: p })));
  const open = openTasks(active);

  const start = range === "month" ? startOfMonth(anchor) : startOfQuarter(anchor);
  const months = range === "month" ? 1 : 3;
  const weeks = buildWeeks(start, months, tasks, today);
  const title =
    range === "month"
      ? monthName(start)
      : `${shortMonthName(start)} to ${shortMonthName(addMonths(start, 2))} ${start.slice(0, 4)}`;

  const step = (direction: number) => setAnchor(addMonths(start, direction * months));
  const selectedTasks = selected ? tasks.filter((t) => t.due === selected) : [];

  return (
    <main className="page">
      <WhenReady ready={ready}>
        <header className="rise" style={{ marginBottom: "1.5rem" }}>
          <p className="eyebrow" style={{ marginBottom: "0.75rem" }}>Across every project</p>
          <h1 className="display-l">Calendar</h1>
          <p className="muted" style={{ marginTop: "0.75rem" }}>
            {open.length} open {open.length === 1 ? "task" : "tasks"} across {active.length}{" "}
            {active.length === 1 ? "project" : "projects"}. A fuller week is a darker bar.
          </p>
        </header>

        <div className="row-between wrap rise" style={{ ["--i" as string]: 1, gap: "0.75rem", marginBottom: "1.25rem" }}>
          <div className="row" style={{ gap: "0.5rem" }}>
            <button type="button" className="icon-btn" aria-label="Earlier" onClick={() => step(-1)}>
              <ChevronLeft size={18} />
            </button>
            <h2 className="display-s" style={{ minWidth: "11ch" }}>{title}</h2>
            <button type="button" className="icon-btn" aria-label="Later" onClick={() => step(1)}>
              <ChevronRight size={18} />
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAnchor(startOfMonth(today))}>
              Today
            </button>
          </div>
          <div className="segmented" role="group" aria-label="Range">
            {(["month", "quarter"] as Range[]).map((r) => (
              <button key={r} type="button" aria-pressed={range === r} onClick={() => setRange(r)}>
                {r === "month" ? "Month" : "Quarter"}
              </button>
            ))}
          </div>
        </div>

        <div className="calendar rise" style={{ ["--i" as string]: 2 }}>
          <div className="calendar-head">
            {WEEKDAYS.map((d) => (
              <span key={d} className="eyebrow">{d}</span>
            ))}
          </div>
          {weeks.map((week) => (
            <Week
              key={week.start}
              week={week}
              compact={range === "quarter"}
              selected={selected}
              onSelect={setSelected}
            />
          ))}
        </div>

        {selected && (
          <section className="rise" style={{ marginTop: "2rem" }}>
            <div className="section-title">
              <h2>
                {shortDate(dayToDate(selected))}
                <span className="count">{selectedTasks.length}</span>
              </h2>
            </div>
            {selectedTasks.length === 0 ? (
              <p className="muted">Nothing due that day.</p>
            ) : (
              <div className="card checklist">
                {selectedTasks.map((task) => (
                  <DayTask key={`${task.projectId}-${task.id}`} task={task} />
                ))}
              </div>
            )}
          </section>
        )}
      </WhenReady>
    </main>
  );
}

function Week({
  week,
  compact,
  selected,
  onSelect,
}: {
  week: CalendarWeek;
  compact: boolean;
  selected: string | null;
  onSelect: (day: string) => void;
}) {
  return (
    <div className="calendar-week" data-compact={compact}>
      <span className="calendar-density" style={{ ["--density" as string]: week.density }} aria-hidden />
      {week.days.map((day) => (
        <button
          key={day.day}
          type="button"
          className="calendar-day"
          data-in-range={day.inRange}
          data-today={day.isToday}
          aria-pressed={selected === day.day}
          aria-label={`${shortDate(dayToDate(day.day))}, ${day.tasks.length} due`}
          onClick={() => onSelect(day.day)}
        >
          <span className="calendar-date">{Number(day.day.slice(8))}</span>
          {compact ? (
            <span className="calendar-dots">
              {day.tasks.slice(0, 6).map((t) => (
                <span key={`${t.projectId}-${t.id}`} className="calendar-dot" style={swatchVar(t.project.swatch)} />
              ))}
            </span>
          ) : (
            <span className="calendar-entries">
              {day.tasks.slice(0, 3).map((t) => (
                <span key={`${t.projectId}-${t.id}`} className="calendar-entry" style={swatchVar(t.project.swatch)} data-done={t.done}>
                  {t.title}
                </span>
              ))}
              {day.tasks.length > 3 && <span className="tiny muted">+{day.tasks.length - 3} more</span>}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

function DayTask({ task }: { task: ProjectTask }) {
  const { setCheck, updateTask } = useStudio();
  const project = task.project;
  const document = task.outputDocumentId ? project.documents.find((d) => d.id === task.outputDocumentId) : undefined;
  const phaseName = getWorkflow(project).phases.find((p) => p.key === task.phaseKey)?.name ?? task.phaseKey;

  return (
    <div className="check-row" style={{ gridTemplateColumns: "auto minmax(0,1fr) auto", cursor: "default" }}>
      <button
        type="button"
        role="checkbox"
        aria-checked={task.done}
        aria-label={task.done ? `Mark "${task.title}" as not done` : `Mark "${task.title}" done`}
        className="check-box"
        onClick={() =>
          task.source === "step"
            ? void setCheck(project.id, task.id, !task.done)
            : updateTask(project.id, task.id, { done: !task.done })
        }
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
          {document && (
            <Link href={`/projects/${project.id}/documents`} className="row muted" style={{ gap: "0.25rem" }}>
              <FileText size={12} /> {document.name}
            </Link>
          )}
        </span>
      </span>
      <span />
    </div>
  );
}
