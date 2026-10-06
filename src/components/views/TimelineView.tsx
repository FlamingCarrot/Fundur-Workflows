"use client";

import React, { useRef, useState } from "react";
import Link from "next/link";
import { RotateCcw } from "lucide-react";
import { useStudio } from "@/components/providers/StudioProvider";
import { Swatch, WhenReady, swatchVar } from "@/components/ui/primitives";
import { addDays, daysBetween, phaseSpans, timelineRange, type PhaseSpan } from "@/lib/studio/timeline";
import { dayToDate, toDay } from "@/lib/studio/tasks";
import { shortDate } from "@/lib/studio/format";
import { phaseState } from "@/lib/studio/selectors";
import type { Project } from "@/lib/studio/types";

/**
 * Six phase bars per project on one timeline (P2-06), so she can see how
 * projects overlap before taking on another. Dragging a bar moves that phase,
 * and every step inside it moves with it.
 */
export function TimelineView() {
  const { projects, ready } = useStudio();
  const active = projects.filter((p) => p.status !== "complete");
  const range = timelineRange(active);
  const today = toDay(new Date());

  return (
    <main className="page">
      <WhenReady ready={ready}>
        <header className="rise" style={{ marginBottom: "1.75rem" }}>
          <p className="eyebrow" style={{ marginBottom: "0.75rem" }}>How the projects overlap</p>
          <h1 className="display-l">Timeline</h1>
          <p className="muted" style={{ marginTop: "0.75rem" }}>
            Each bar is a phase, from its first dated step to its last. Drag one to move it; its steps move with it.
          </p>
        </header>

        {active.length === 0 ? (
          <p className="muted">No projects on the go.</p>
        ) : (
          <div className="timeline rise" style={{ ["--i" as string]: 1 }}>
            <Months range={range} />
            {active.map((project) => (
              <ProjectRow key={project.id} project={project} range={range} today={today} />
            ))}
          </div>
        )}
      </WhenReady>
    </main>
  );
}

interface Range {
  start: string;
  end: string;
  days: number;
}

function Months({ range }: { range: Range }) {
  const months: { label: string; left: number; width: number }[] = [];
  let cursor = range.start;
  while (cursor <= range.end) {
    const monthStart = cursor;
    const firstOfNext = `${addDays(`${monthStart.slice(0, 7)}-01`, 32).slice(0, 7)}-01`;
    const monthEnd = firstOfNext > range.end ? range.end : addDays(firstOfNext, -1);
    months.push({
      label: dayToDate(monthStart).toLocaleDateString("en-ZA", { month: "short" }),
      left: (daysBetween(range.start, monthStart) / range.days) * 100,
      width: ((daysBetween(monthStart, monthEnd) + 1) / range.days) * 100,
    });
    cursor = addDays(monthEnd, 1);
  }
  return (
    <div className="timeline-row timeline-months">
      <span className="timeline-label" />
      <span className="timeline-track">
        {months.map((m) => (
          <span key={m.left} className="timeline-month eyebrow" style={{ left: `${m.left}%`, width: `${m.width}%` }}>
            {m.label}
          </span>
        ))}
      </span>
    </div>
  );
}

function ProjectRow({ project, range, today }: { project: Project; range: Range; today: string }) {
  const { setPhaseStart, toast } = useStudio();
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<{ key: string; offsetDays: number } | null>(null);
  const spans = phaseSpans(project);
  const moved = spans.filter((s) => s.shiftDays !== 0);

  /** How many days one pixel is, so a drag moves whole days. */
  const daysPerPixel = () => range.days / (trackRef.current?.clientWidth || 1);

  const onPointerDown = (e: React.PointerEvent, span: PhaseSpan) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDragging({ key: span.key, offsetDays: 0 });
  };

  const onPointerMove = (e: React.PointerEvent, span: PhaseSpan) => {
    if (dragging?.key !== span.key) return;
    setDragging({ key: span.key, offsetDays: Math.round(e.movementX * daysPerPixel()) + dragging.offsetDays });
  };

  const onPointerUp = (span: PhaseSpan) => {
    if (dragging?.key !== span.key) return;
    const days = dragging.offsetDays;
    setDragging(null);
    if (!days) return;
    const start = addDays(span.start, days);
    setPhaseStart(project.id, span.key, start);
    toast(`${span.name} now starts ${shortDate(dayToDate(start))}`);
  };

  return (
    <div className="timeline-row">
      <Link href={`/projects/${project.id}`} className="timeline-label row" style={{ gap: "0.5rem", minWidth: 0 }}>
        <Swatch swatch={project.swatch} />
        <span className="small strong truncate">{project.name}</span>
      </Link>
      <div className="timeline-track" ref={trackRef} style={swatchVar(project.swatch)}>
        <span
          className="timeline-today"
          style={{ left: `${(daysBetween(range.start, today) / range.days) * 100}%` }}
          aria-hidden
        />
        {spans.map((span) => {
          const offset = dragging?.key === span.key ? dragging.offsetDays : 0;
          const left = ((daysBetween(range.start, span.start) + offset) / range.days) * 100;
          const width = (span.days / range.days) * 100;
          const state = phaseState(project, span.key);
          return (
            <button
              key={span.key}
              type="button"
              className="timeline-bar"
              data-state={state}
              data-dragging={dragging?.key === span.key}
              style={{ left: `${left}%`, width: `${width}%` }}
              title={`${span.name}: ${shortDate(dayToDate(span.start))} to ${shortDate(dayToDate(span.end))}`}
              aria-label={`${span.name}, ${shortDate(dayToDate(span.start))} to ${shortDate(dayToDate(span.end))}. Arrow keys move it a day at a time.`}
              onPointerDown={(e) => onPointerDown(e, span)}
              onPointerMove={(e) => onPointerMove(e, span)}
              onPointerUp={() => onPointerUp(span)}
              onPointerCancel={() => setDragging(null)}
              onKeyDown={(e) => {
                // The same move without a mouse, which is also how it is tested.
                const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
                if (!step) return;
                e.preventDefault();
                setPhaseStart(project.id, span.key, addDays(span.start, step));
              }}
            >
              <span className="truncate">{span.name}</span>
            </button>
          );
        })}
      </div>
      {moved.length > 0 && (
        <button
          type="button"
          className="icon-btn"
          aria-label={`Put ${project.name} back on the workflow's plan`}
          title="Back to the workflow's plan"
          onClick={() => {
            for (const span of moved) setPhaseStart(project.id, span.key, null);
            toast(`${project.name} is back on the workflow's plan`);
          }}
        >
          <RotateCcw size={15} />
        </button>
      )}
    </div>
  );
}
