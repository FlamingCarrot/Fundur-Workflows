"use client";

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Download,
  Link2,
  MoreHorizontal,
  Plus,
  Printer,
  Undo2,
  TriangleAlert,
} from "lucide-react";
import { useStudio } from "@/components/providers/StudioProvider";
import { Swatch, WhenReady, swatchVar } from "@/components/ui/primitives";
import { addDays, daysBetween, phaseSpans, projectRange, type PhaseSpan } from "@/lib/studio/timeline";
import { dayToDate, projectTasks, toDay, type Task } from "@/lib/studio/tasks";
import {
  baselineSlip,
  criticalPath,
  isWeekend,
  linkConflicts,
  applyPlanMutation,
  planMove,
  planResize,
  timelineCsv,
  undoSchedule,
  weeklyWorkload,
  workload,
  type PlanMutation,
} from "@/lib/studio/schedule";
import { shortDate } from "@/lib/studio/format";
import { phaseState } from "@/lib/studio/selectors";
import { getWorkflow } from "@/lib/workflow";
import type { Project } from "@/lib/studio/types";
import { TaskSheet, ProjectSheet } from "./TimelineSheets";
import { useRemembered } from "@/hooks/useRemembered";

/**
 * The timeline as a planning tool (docs/timeline/pm-timeline-audit.md):
 * projects, their phases and their tasks on one chart. Bars move and stretch
 * by dragging; a task can wait on others and pushes them when it slips;
 * milestones, the critical path, a saved baseline and the week's workload
 * are there when asked for. Every view setting is remembered.
 */

export type Zoom = "week" | "month" | "quarter";
const PX_PER_DAY: Record<Zoom, number> = { week: 40, month: 16, quarter: 6 };
const ZOOM_LABEL: Record<Zoom, string> = { week: "Week", month: "Month", quarter: "Quarter" };
const ROW_H = 38;

interface Prefs {
  zoom: Zoom;
  projectId: string;
  showDone: boolean;
  critical: boolean;
  baseline: boolean;
  workload: boolean;
  /** Projects and phases opened; a phase is "projectId:phaseKey". */
  open: string[];
}

const DEFAULT_PREFS: Prefs = {
  zoom: "month",
  projectId: "all",
  showDone: true,
  critical: false,
  baseline: false,
  workload: false,
  open: [],
};

type Row =
  | { kind: "project"; project: Project }
  | { kind: "phase"; project: Project; span: PhaseSpan }
  | { kind: "task"; project: Project; task: Task }
  | { kind: "add"; project: Project; span: PhaseSpan };

interface Geometry {
  start: string;
  days: number;
  ppd: number;
  x: (day: string) => number;
}

interface UndoEntry {
  label: string;
  run: () => void;
}

export function TimelineView() {
  const studio = useStudio();
  const { projects, ready, planProject, setPhaseStart, toast } = studio;
  const [prefs, setPrefs] = useRemembered<Prefs>("timeline", DEFAULT_PREFS);
  const set = useCallback(<K extends keyof Prefs>(key: K, value: Prefs[K]) => setPrefs((p) => ({ ...p, [key]: value })), [setPrefs]);
  const [undo, setUndo] = useState<UndoEntry[]>([]);
  const [sheet, setSheet] = useState<{ projectId: string; taskId: string } | null>(null);
  const [projectSheet, setProjectSheet] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const today = toDay(new Date());

  const active = projects.filter((p) => p.status !== "complete");
  const shown = prefs.projectId === "all" ? active : active.filter((p) => p.id === prefs.projectId);
  const open = useMemo(() => new Set(prefs.open), [prefs.open]);

  const toggleOpen = (key: string) =>
    setPrefs((p) => ({ ...p, open: p.open.includes(key) ? p.open.filter((k) => k !== key) : [...p.open, key] }));

  // ---------- Range and scale ----------
  const geometry: Geometry = useMemo(() => {
    let start = today;
    let end = addDays(today, 30);
    for (const project of shown) {
      const r = projectRange(project);
      if (r.start < start) start = r.start;
      if (r.end > end) end = r.end;
      for (const t of projectTasks(project)) {
        if (t.start && t.start < start) start = t.start;
        if (t.due && t.due > end) end = t.due;
      }
    }
    // Start on a Monday a week early, and leave room after the end to drag into.
    const monday = (d: string) => addDays(d, -((dayToDate(d).getDay() + 6) % 7));
    start = monday(addDays(start, -7));
    end = addDays(end, 28);
    const ppd = PX_PER_DAY[prefs.zoom];
    return { start, days: daysBetween(start, end) + 1, ppd, x: (day: string) => daysBetween(start, day) * ppd };
  }, [shown, today, prefs.zoom]);

  // ---------- Rows ----------
  const rows: Row[] = [];
  for (const project of shown) {
    rows.push({ kind: "project", project });
    if (!open.has(project.id)) continue;
    const tasks = inPlanOrder(project);
    for (const span of phaseSpans(project)) {
      rows.push({ kind: "phase", project, span });
      const phaseKey = `${project.id}:${span.key}`;
      if (!open.has(phaseKey)) continue;
      for (const task of tasks) {
        if (task.phaseKey !== span.key) continue;
        if (task.done && !prefs.showDone) continue;
        rows.push({ kind: "task", project, task });
      }
      rows.push({ kind: "add", project, span });
    }
  }

  const critical = useMemo(() => {
    const ids = new Set<string>();
    if (!prefs.critical) return ids;
    for (const project of shown) for (const id of criticalPath(project)) ids.add(`${project.id}:${id}`);
    return ids;
  }, [shown, prefs.critical]);

  const conflicts = useMemo(() => {
    const ids = new Set<string>();
    for (const project of shown) for (const c of linkConflicts(project)) ids.add(`${project.id}:${c.from}>${c.to}`);
    return ids;
  }, [shown]);

  // ---------- Changes, each with its undo ----------
  const remember = (label: string, run: () => void) => setUndo((u) => [...u.slice(-29), { label, run }]);

  const plan = useCallback(
    (project: Project, mutation: PlanMutation, label: string, inverse?: PlanMutation) => {
      void planProject(project.id, mutation);
      if (inverse) remember(label, () => void planProject(project.id, inverse));
    },
    [planProject]
  );

  const moveTask = (project: Project, task: Task, start: string, due: string) => {
    const changes = planMove(project, task.id, start, due);
    plan(project, { type: "scheduleTasks", changes }, `Move ${task.title}`, undoSchedule(project, changes));
    if (changes.length > 1) toast(`${task.title} moved; ${changes.length - 1} waiting task${changes.length > 2 ? "s" : ""} moved with it`);
  };

  const resizeTask = (project: Project, task: Task, edge: "start" | "due", day: string) => {
    const changes = planResize(project, task.id, edge, day);
    plan(project, { type: "scheduleTasks", changes }, `Change ${task.title}`, undoSchedule(project, changes));
  };

  const movePhase = (project: Project, span: PhaseSpan, start: string) => {
    const before = span.start;
    setPhaseStart(project.id, span.key, start);
    remember(`Move ${span.name}`, () => setPhaseStart(project.id, span.key, before));
    toast(`${span.name} now starts ${shortDate(dayToDate(start))}`);
  };

  /**
   * Sets what a task waits on. A new link that it already breaks pushes the
   * task (and what waits on it) to start after; one undo takes back both.
   */
  const linkTask = (project: Project, task: Task, after: string[]) => {
    const before = { type: "setTaskPlan", taskId: task.id, after: task.after ?? [], milestone: !!task.milestone, estimateHours: task.estimateHours ?? null } as const;
    const link: PlanMutation = { ...before, after };
    void planProject(project.id, link);
    const linked = applyPlanMutation(project, link);
    const pushes = after
      .filter((id) => !(task.after ?? []).includes(id))
      .map((id) => projectTasks(linked).find((t) => t.id === id))
      .filter((t): t is Task => !!t && !t.done && !!t.start && !!t.due)
      .flatMap((t) => planMove(linked, t.id, t.start!, t.due!).slice(1));
    const changes = [...new Map(pushes.map((c) => [c.taskId, c])).values()];
    if (changes.length) {
      void planProject(project.id, { type: "scheduleTasks", changes });
      toast(`${task.title} now starts after what it waits on`);
    }
    remember(`Link ${task.title}`, () => {
      if (changes.length) void planProject(project.id, undoSchedule(project, changes));
      void planProject(project.id, before);
    });
  };

  const shiftProject = (project: Project, days: number) => {
    if (!days) return;
    plan(project, { type: "shiftProject", days }, `Shift ${project.name}`, { type: "shiftProject", days: -days });
    toast(`${project.name} moved ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ${days > 0 ? "later" : "earlier"}`);
  };

  const undoRef = useRef(undo);
  useEffect(() => {
    undoRef.current = undo;
  }, [undo]);
  const undoLast = useCallback(() => {
    const last = undoRef.current[undoRef.current.length - 1];
    if (!last) return;
    undoRef.current = undoRef.current.slice(0, -1);
    setUndo(undoRef.current);
    last.run();
    toast(`Undone: ${last.label}`);
  }, [toast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable]")) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        undoLast();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undoLast]);

  // ---------- Scrolling ----------
  const scrollToToday = useCallback(
    (smooth = true) => {
      const el = scrollRef.current;
      if (!el) return;
      el.scrollTo({ left: Math.max(0, geometry.x(today) - el.clientWidth * 0.25), behavior: smooth ? "smooth" : "auto" });
    },
    [geometry, today]
  );
  const scrolledOnce = useRef(false);
  useLayoutEffect(() => {
    if (!ready || scrolledOnce.current || !scrollRef.current) return;
    scrolledOnce.current = true;
    scrollToToday(false);
  }, [ready, scrollToToday]);
  // A new zoom keeps today in view.
  useEffect(() => {
    if (scrolledOnce.current) scrollToToday(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs.zoom]);

  const exportCsv = () => {
    const blob = new Blob([timelineCsv(shown)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `timeline-${today}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const allKeys = shown.flatMap((p) => [p.id, ...phaseSpans(p).map((s) => `${p.id}:${s.key}`)]);
  const allOpen = allKeys.length > 0 && allKeys.every((k) => open.has(k));
  const width = geometry.days * geometry.ppd;
  const sheetProject = sheet ? projects.find((p) => p.id === sheet.projectId) : undefined;
  const sheetTask = sheetProject && sheet ? projectTasks(sheetProject).find((t) => t.id === sheet.taskId) : undefined;
  const sheetPlanProject = projectSheet ? projects.find((p) => p.id === projectSheet) : undefined;

  return (
    <main className="page page-wide tl-page">
      <WhenReady ready={ready}>
        <header className="rise tl-header">
          <div>
            <p className="eyebrow" style={{ marginBottom: "0.75rem" }}>Plan every project</p>
            <h1 className="display-l">Timeline</h1>
          </div>
        </header>

        <div className="tl-toolbar rise" style={{ ["--i" as string]: 1 }} role="toolbar" aria-label="Timeline controls">
          <div className="segmented" role="group" aria-label="Zoom">
            {(Object.keys(ZOOM_LABEL) as Zoom[]).map((z) => (
              <button key={z} type="button" aria-pressed={prefs.zoom === z} onClick={() => set("zoom", z)}>
                {ZOOM_LABEL[z]}
              </button>
            ))}
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => scrollToToday()}>Today</button>
          <select
            className="input tl-select"
            aria-label="Projects shown"
            value={shown.length === active.length ? "all" : prefs.projectId}
            onChange={(e) => set("projectId", e.target.value)}
          >
            <option value="all">All projects</option>
            {active.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <span className="tl-toolbar-gap" />
          <button type="button" className="chip" aria-pressed={prefs.critical} onClick={() => set("critical", !prefs.critical)} title="Highlight the tasks that decide each project's end">
            Critical path
          </button>
          <button type="button" className="chip" aria-pressed={prefs.baseline} onClick={() => set("baseline", !prefs.baseline)} title="Compare with the plan you saved">
            Baseline
          </button>
          <button type="button" className="chip" aria-pressed={prefs.workload} onClick={() => set("workload", !prefs.workload)} title="Hours planned each day against a working day">
            Workload
          </button>
          <button type="button" className="chip" aria-pressed={prefs.showDone} onClick={() => set("showDone", !prefs.showDone)}>
            Done tasks
          </button>
          <span className="tl-toolbar-icons">
            <button
              type="button"
              className="icon-btn"
              title={allOpen ? "Collapse all" : "Expand all"}
              aria-label={allOpen ? "Collapse all" : "Expand all"}
              onClick={() => set("open", allOpen ? [] : allKeys)}
            >
              {allOpen ? <ChevronsDownUp size={16} /> : <ChevronsUpDown size={16} />}
            </button>
            <button
              type="button"
              className="icon-btn"
              title={undo.length ? `Undo: ${undo[undo.length - 1].label} (Ctrl Z)` : "Nothing to undo"}
              aria-label="Undo"
              disabled={!undo.length}
              onClick={undoLast}
            >
              <Undo2 size={16} />
            </button>
            <button type="button" className="icon-btn" title="Download as CSV" aria-label="Download as CSV" onClick={exportCsv}>
              <Download size={16} />
            </button>
            <button type="button" className="icon-btn" title="Print" aria-label="Print" onClick={() => window.print()}>
              <Printer size={16} />
            </button>
          </span>
        </div>

        {shown.length === 0 ? (
          <p className="muted">No projects on the go.</p>
        ) : (
          <div className="tl-chart rise" style={{ ["--i" as string]: 2 }} ref={scrollRef}>
            <div className="tl-canvas" style={{ ["--track-w" as string]: `${width}px`, ["--ppd" as string]: `${geometry.ppd}px` }}>
              <Scale geometry={geometry} zoom={prefs.zoom} today={today} />
              {prefs.workload && <WorkloadRow geometry={geometry} zoom={prefs.zoom} projects={shown} />}
              <div className="tl-rows" style={{ height: rows.length * ROW_H }}>
                <Grid geometry={geometry} zoom={prefs.zoom} today={today} />
                <Links rows={rows} geometry={geometry} conflicts={conflicts} />
                {rows.map((row, index) => (
                  <RowView
                    key={rowKey(row)}
                    row={row}
                    index={index}
                    geometry={geometry}
                    today={today}
                    open={open}
                    prefs={prefs}
                    critical={critical}
                    conflicts={conflicts}
                    onToggle={toggleOpen}
                    onMoveTask={moveTask}
                    onResizeTask={resizeTask}
                    onMovePhase={movePhase}
                    onShiftProject={shiftProject}
                    onOpenTask={(p, t) => setSheet({ projectId: p.id, taskId: t.id })}
                    onOpenProject={(p) => setProjectSheet(p.id)}
                    onSchedule={(p, t, day) => moveTask(p, t, day, day)}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        <p className="tl-hint muted small">
          Drag a bar to move it, its ends to change its days. Arrow keys move the selected bar a day; Shift with an arrow changes its length.
          A task that waits on another moves when that one slips.
        </p>

        {sheetProject && sheetTask && (
          <TaskSheet
            project={sheetProject}
            task={sheetTask}
            onClose={() => setSheet(null)}
            onPlan={(mutation, label, inverse) => plan(sheetProject, mutation, label, inverse)}
            onMove={(start, due) => moveTask(sheetProject, sheetTask, start, due)}
            onLink={(after) => linkTask(sheetProject, sheetTask, after)}
          />
        )}
        {sheetPlanProject && (
          <ProjectSheet
            project={sheetPlanProject}
            onClose={() => setProjectSheet(null)}
            onShift={(days) => shiftProject(sheetPlanProject, days)}
            onPlan={(mutation, label, inverse) => plan(sheetPlanProject, mutation, label, inverse)}
            onResetPhases={() => {
              const moved = phaseSpans(sheetPlanProject).filter((s) => s.shiftDays !== 0);
              for (const span of moved) setPhaseStart(sheetPlanProject.id, span.key, null);
              toast(`${sheetPlanProject.name} is back on the workflow's plan`);
            }}
          />
        )}
      </WhenReady>
    </main>
  );
}

/**
 * Tasks in the order the workflow lists them, then her own by date, so a row
 * stays where it is when its bar moves.
 */
function inPlanOrder(project: Project): Task[] {
  const order = new Map<string, number>();
  getWorkflow(project).phases.forEach((ph) => ph.checklist.forEach((item, i) => order.set(item.id, i)));
  return projectTasks(project).sort((a, b) => {
    const ia = order.get(a.id) ?? Infinity;
    const ib = order.get(b.id) ?? Infinity;
    if (ia !== ib) return ia - ib;
    return (a.due ?? "~").localeCompare(b.due ?? "~") || a.title.localeCompare(b.title);
  });
}

function rowKey(row: Row): string {
  switch (row.kind) {
    case "project":
      return `p:${row.project.id}`;
    case "phase":
      return `ph:${row.project.id}:${row.span.key}`;
    case "task":
      return `t:${row.project.id}:${row.task.id}`;
    case "add":
      return `a:${row.project.id}:${row.span.key}`;
  }
}

// ---------- The scale across the top ----------

function Scale({ geometry, zoom, today }: { geometry: Geometry; zoom: Zoom; today: string }) {
  const months: { label: string; left: number; width: number }[] = [];
  const ticks: { label: string; left: number; today: boolean; weekend: boolean }[] = [];
  const end = addDays(geometry.start, geometry.days - 1);
  let cursor = geometry.start;
  while (cursor <= end) {
    const firstOfNext = `${addDays(`${cursor.slice(0, 7)}-01`, 32).slice(0, 7)}-01`;
    const monthEnd = firstOfNext > end ? end : addDays(firstOfNext, -1);
    const date = dayToDate(cursor);
    months.push({
      label: date.toLocaleDateString("en-ZA", { month: zoom === "quarter" ? "short" : "long", ...(date.getMonth() === 0 || months.length === 0 ? { year: "numeric" } : {}) }),
      left: geometry.x(cursor),
      width: (daysBetween(cursor, monthEnd) + 1) * geometry.ppd,
    });
    cursor = addDays(monthEnd, 1);
  }
  for (let d = geometry.start; d <= end; d = addDays(d, 1)) {
    const date = dayToDate(d);
    if (zoom === "week") {
      ticks.push({ label: `${"SMTWTFS"[date.getDay()]} ${date.getDate()}`, left: geometry.x(d), today: d === today, weekend: isWeekend(d) });
    } else if (zoom === "month" && date.getDay() === 1) {
      ticks.push({ label: String(date.getDate()), left: geometry.x(d), today: false, weekend: false });
    }
  }
  return (
    <div className="tl-scale">
      <div className="tl-label tl-scale-label" />
      <div className="tl-track">
        <div className="tl-months">
          {months.map((m) => (
            <span key={m.left} className="tl-month" style={{ left: m.left, width: m.width }}>
              <span className="truncate">{m.label}</span>
            </span>
          ))}
        </div>
        {ticks.length > 0 && (
          <div className="tl-ticks">
            {ticks.map((t) => (
              <span
                key={t.left}
                className="tl-tick"
                data-today={t.today || undefined}
                data-weekend={t.weekend || undefined}
                style={{ left: t.left, width: zoom === "week" ? geometry.ppd : geometry.ppd * 7 }}
              >
                {t.label}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Weekend shading, week lines and the today line behind the rows. */
function Grid({ geometry, zoom, today }: { geometry: Geometry; zoom: Zoom; today: string }) {
  const { ppd } = geometry;
  // The first Saturday on the chart, so the shading lines up with the days.
  const toSaturday = (6 - dayToDate(geometry.start).getDay() + 7) % 7;
  const style: React.CSSProperties =
    zoom === "quarter"
      ? {}
      : {
          backgroundImage: `linear-gradient(to right, var(--tl-weekend) 0 ${2 * ppd}px, transparent ${2 * ppd}px ${7 * ppd}px)`,
          backgroundSize: `${7 * ppd}px 100%`,
          backgroundPosition: `${toSaturday * ppd}px 0`,
        };
  return (
    <div className="tl-grid" aria-hidden>
      <div className="tl-grid-track" style={style}>
        <span className="tl-today" style={{ left: geometry.x(today) + ppd / 2 }} />
      </div>
    </div>
  );
}

// ---------- Workload ----------

function WorkloadRow({ geometry, zoom, projects }: { geometry: Geometry; zoom: Zoom; projects: Project[] }) {
  const end = addDays(geometry.start, geometry.days - 1);
  const daily = workload(projects, geometry.start, end);
  const cells = zoom === "quarter" ? weeklyWorkload(daily) : daily;
  const cellDays = zoom === "quarter" ? 7 : 1;
  return (
    <div className="tl-row tl-workload">
      <div className="tl-label">
        <span className="small strong">Workload</span>
        <span className="tl-sub">hours a {cellDays === 7 ? "week" : "day"}</span>
      </div>
      <div className="tl-track">
        {cells.map((c) => {
          if (c.hours <= 0) return null;
          const load = c.capacity ? c.hours / c.capacity : 2;
          const over = c.hours > c.capacity;
          return (
            <span
              key={c.day}
              className="tl-load"
              data-over={over || undefined}
              style={{ left: geometry.x(c.day) + 1, width: geometry.ppd * cellDays - 2, height: `${Math.min(1, load) * 100}%` }}
              title={`${shortDate(dayToDate(c.day))}${cellDays === 7 ? " week" : ""}: ${round(c.hours)}h planned of ${c.capacity}h${over ? ", over capacity" : ""}`}
            />
          );
        })}
      </div>
    </div>
  );
}

const round = (n: number) => Math.round(n * 10) / 10;

// ---------- Dependency arrows ----------

function Links({ rows, geometry, conflicts }: { rows: Row[]; geometry: Geometry; conflicts: Set<string> }) {
  const where = new Map<string, { index: number; task: Task }>();
  rows.forEach((row, index) => {
    if (row.kind === "task") where.set(`${row.project.id}:${row.task.id}`, { index, task: row.task });
  });
  const paths: { d: string; bad: boolean; key: string }[] = [];
  for (const row of rows) {
    if (row.kind !== "task" || !row.task.start) continue;
    const to = where.get(`${row.project.id}:${row.task.id}`)!;
    for (const id of row.task.after ?? []) {
      const from = where.get(`${row.project.id}:${id}`);
      if (!from?.task.due) continue;
      const x1 = geometry.x(from.task.due) + geometry.ppd;
      const y1 = from.index * ROW_H + ROW_H / 2;
      const x2 = geometry.x(row.task.start);
      const y2 = to.index * ROW_H + ROW_H / 2;
      // Down from just inside the end of what it waits on, then across into the waiting bar;
      // when that bar starts earlier still, round the back of it.
      const elbow = Math.max(geometry.x(from.task.start ?? from.task.due), x1 - 10);
      const edge = y2 > y1 ? y1 + 8 : y1 - 8;
      paths.push({
        key: `${id}>${row.task.id}`,
        bad: conflicts.has(`${row.project.id}:${id}>${row.task.id}`),
        d:
          x2 - elbow >= 6
            ? `M${elbow},${edge} V${y2} H${x2 - 2}`
            : `M${x1},${y1} H${x1 + 8} V${y2 - ROW_H / 2} H${x2 - 10} V${y2} H${x2 - 2}`,
      });
    }
  }
  if (!paths.length) return null;
  return (
    <svg className="tl-links" width={geometry.days * geometry.ppd} height={rows.length * ROW_H} aria-hidden>
      <defs>
        <marker id="tl-arrow" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0,0 L8,4 L0,8 z" fill="var(--ink-3)" />
        </marker>
        <marker id="tl-arrow-bad" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0,0 L8,4 L0,8 z" fill="var(--bad)" />
        </marker>
      </defs>
      {paths.map((p) => (
        <path key={p.key} d={p.d} className="tl-link" data-bad={p.bad || undefined} markerEnd={`url(#${p.bad ? "tl-arrow-bad" : "tl-arrow"})`} />
      ))}
    </svg>
  );
}

// ---------- One row ----------

interface RowProps {
  row: Row;
  index: number;
  geometry: Geometry;
  today: string;
  open: Set<string>;
  prefs: Prefs;
  critical: Set<string>;
  conflicts: Set<string>;
  onToggle: (key: string) => void;
  onMoveTask: (project: Project, task: Task, start: string, due: string) => void;
  onResizeTask: (project: Project, task: Task, edge: "start" | "due", day: string) => void;
  onMovePhase: (project: Project, span: PhaseSpan, start: string) => void;
  onShiftProject: (project: Project, days: number) => void;
  onOpenTask: (project: Project, task: Task) => void;
  onOpenProject: (project: Project) => void;
  onSchedule: (project: Project, task: Task, day: string) => void;
}

type DragMode = "move" | "start" | "due";

/**
 * Dragging a bar or one of its ends by whole days. A press that does not move
 * is a click. Returns the days moved so far, for drawing, and the handlers.
 */
function useDrag(ppd: number, onDrop: (mode: DragMode, days: number) => void, onClick: () => void) {
  const state = useRef<{ mode: DragMode; x: number; moved: boolean } | null>(null);
  const [preview, setPreview] = useState<{ mode: DragMode; days: number } | null>(null);
  const bind = (mode: DragMode) => ({
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      state.current = { mode, x: e.clientX, moved: false };
      setPreview({ mode, days: 0 });
    },
    onPointerMove: (e: React.PointerEvent) => {
      const s = state.current;
      if (!s || s.mode !== mode) return;
      const dx = e.clientX - s.x;
      if (Math.abs(dx) > 3) s.moved = true;
      setPreview({ mode, days: Math.round(dx / ppd) });
    },
    onPointerUp: (e: React.PointerEvent) => {
      const s = state.current;
      if (!s || s.mode !== mode) return;
      state.current = null;
      setPreview(null);
      const days = Math.round((e.clientX - s.x) / ppd);
      if (!s.moved) onClick();
      else if (days) onDrop(mode, days);
    },
    onPointerCancel: () => {
      state.current = null;
      setPreview(null);
    },
  });
  return { preview, bind };
}

function RowView(props: RowProps) {
  const { row, index } = props;
  return (
    <div
      className="tl-row"
      data-kind={row.kind}
      style={{ top: index * ROW_H, height: ROW_H, ...swatchVar(row.project.swatch) }}
    >
      {row.kind === "project" && <ProjectRow {...props} project={row.project} />}
      {row.kind === "phase" && <PhaseRow {...props} project={row.project} span={row.span} />}
      {row.kind === "task" && <TaskRow {...props} project={row.project} task={row.task} />}
      {row.kind === "add" && <AddRow project={row.project} span={row.span} />}
    </div>
  );
}

function progressOf(tasks: Task[]): number {
  return tasks.length ? tasks.filter((t) => t.done).length / tasks.length : 0;
}

function ProjectRow({ project, geometry, open, prefs, onToggle, onShiftProject, onOpenProject }: RowProps & { project: Project }) {
  const range = projectRange(project);
  const tasks = projectTasks(project);
  const progress = progressOf(tasks);
  const slip = prefs.baseline ? baselineSlip(project) : null;
  const isOpen = open.has(project.id);
  const { preview, bind } = useDrag(geometry.ppd, (_, days) => onShiftProject(project, days), () => onToggle(project.id));
  const offset = preview?.days ?? 0;
  const wasEnd = project.baseline ? Object.values(project.baseline.phases).reduce((m, p) => (p.end > m ? p.end : m), "") : "";
  const wasStart = project.baseline ? Object.values(project.baseline.phases).reduce((m, p) => (!m || p.start < m ? p.start : m), "") : "";

  return (
    <>
      <div className="tl-label">
        <button type="button" className="tl-caret" aria-expanded={isOpen} aria-label={`${isOpen ? "Hide" : "Show"} ${project.name}'s phases`} onClick={() => onToggle(project.id)}>
          <ChevronRight size={15} />
        </button>
        <Swatch swatch={project.swatch} />
        <Link href={`/projects/${project.id}`} className="small strong truncate tl-name">{project.name}</Link>
        {slip && slip.endDays !== 0 && (
          <span className="tl-slip" data-late={slip.endDays > 0 || undefined} title="Days the end moved since the baseline">
            {slip.endDays > 0 ? "+" : ""}{slip.endDays}d
          </span>
        )}
        <button type="button" className="icon-btn tl-more" aria-label={`Plan ${project.name}`} title="Shift, baseline" onClick={() => onOpenProject(project)}>
          <MoreHorizontal size={15} />
        </button>
      </div>
      <div className="tl-track">
        {prefs.baseline && wasStart && (
          <span className="tl-ghost" style={{ left: geometry.x(wasStart), width: (daysBetween(wasStart, wasEnd) + 1) * geometry.ppd }} />
        )}
        <button
          type="button"
          className="tl-bar tl-bar-project"
          data-dragging={preview ? true : undefined}
          style={{ left: geometry.x(range.start) + offset * geometry.ppd, width: (daysBetween(range.start, range.end) + 1) * geometry.ppd }}
          title={`${project.name}: ${shortDate(dayToDate(range.start))} to ${shortDate(dayToDate(range.end))}, ${Math.round(progress * 100)}% done. Drag to shift the whole project.`}
          aria-label={`${project.name}, ${shortDate(dayToDate(range.start))} to ${shortDate(dayToDate(range.end))}. Arrow keys shift the whole project a day.`}
          {...bind("move")}
          onKeyDown={(e) => {
            const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
            if (step) {
              e.preventDefault();
              onShiftProject(project, step);
            } else if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onToggle(project.id);
            }
          }}
        >
          <span className="tl-fill" style={{ width: `${progress * 100}%` }} />
          <span className="tl-bar-text truncate">{Math.round(progress * 100)}%</span>
        </button>
      </div>
    </>
  );
}

function PhaseRow({ project, span, geometry, open, prefs, onToggle, onMovePhase }: RowProps & { project: Project; span: PhaseSpan }) {
  const key = `${project.id}:${span.key}`;
  const isOpen = open.has(key);
  const tasks = projectTasks(project).filter((t) => t.phaseKey === span.key);
  const progress = progressOf(tasks);
  const state = phaseState(project, span.key);
  const { preview, bind } = useDrag(geometry.ppd, (_, days) => onMovePhase(project, span, addDays(span.start, days)), () => onToggle(key));
  const offset = preview?.days ?? 0;
  const was = prefs.baseline ? project.baseline?.phases[span.key] : undefined;

  return (
    <>
      <div className="tl-label tl-indent-1">
        <button type="button" className="tl-caret" aria-expanded={isOpen} aria-label={`${isOpen ? "Hide" : "Show"} ${span.name} tasks`} onClick={() => onToggle(key)}>
          <ChevronRight size={14} />
        </button>
        <Link href={`/projects/${project.id}/phases/${span.key}`} className="small truncate tl-name">{span.name}</Link>
        <span className="tl-sub">{tasks.filter((t) => t.done).length}/{tasks.length}</span>
      </div>
      <div className="tl-track">
        {was && <span className="tl-ghost" style={{ left: geometry.x(was.start), width: (daysBetween(was.start, was.end) + 1) * geometry.ppd }} />}
        <button
          type="button"
          className="tl-bar tl-bar-phase"
          data-state={state}
          data-dragging={preview ? true : undefined}
          style={{ left: geometry.x(span.start) + offset * geometry.ppd, width: span.days * geometry.ppd }}
          title={`${span.name}: ${shortDate(dayToDate(span.start))} to ${shortDate(dayToDate(span.end))}. Drag to move it; the phases after it move too.`}
          aria-label={`${span.name}, ${shortDate(dayToDate(span.start))} to ${shortDate(dayToDate(span.end))}. Arrow keys move it a day at a time.`}
          {...bind("move")}
          onKeyDown={(e) => {
            const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
            if (step) {
              e.preventDefault();
              onMovePhase(project, span, addDays(span.start, step));
            } else if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onToggle(key);
            }
          }}
        >
          <span className="tl-fill" style={{ width: `${progress * 100}%` }} />
          <span className="tl-bar-text truncate">{span.name}</span>
        </button>
      </div>
    </>
  );
}

function TaskRow({
  project,
  task,
  geometry,
  today,
  prefs,
  critical,
  conflicts,
  onMoveTask,
  onResizeTask,
  onOpenTask,
  onSchedule,
}: RowProps & { project: Project; task: Task }) {
  const { preview, bind } = useDrag(
    geometry.ppd,
    (mode, days) => {
      if (!task.start || !task.due) return;
      if (mode === "move") onMoveTask(project, task, addDays(task.start, days), addDays(task.due, days));
      else onResizeTask(project, task, mode, addDays(mode === "start" ? task.start : task.due, days));
    },
    () => onOpenTask(project, task)
  );
  const overdue = !task.done && !!task.due && task.due < today;
  const isCritical = critical.has(`${project.id}:${task.id}`);
  const late = (task.after ?? []).some((id) => conflicts.has(`${project.id}:${id}>${task.id}`));
  const was = prefs.baseline ? project.baseline?.tasks[task.id] : undefined;

  let start = task.start;
  let due = task.due;
  if (start && due && preview) {
    if (preview.mode === "move") {
      start = addDays(start, preview.days);
      due = addDays(due, preview.days);
    } else if (preview.mode === "start") {
      start = addDays(start, preview.days);
      if (start > due) start = due;
    } else {
      due = addDays(due, preview.days);
      if (due < start) due = start;
    }
  }
  const range = start && due ? `${shortDate(dayToDate(start))}${start !== due ? ` to ${shortDate(dayToDate(due))}` : ""}` : "No date";

  return (
    <>
      <div className="tl-label tl-indent-2">
        <span className="tl-dot" data-done={task.done || undefined} aria-hidden />
        <button type="button" className="tl-task-name small truncate" data-done={task.done || undefined} onClick={() => onOpenTask(project, task)}>
          {task.title}
        </button>
        {(task.after?.length ?? 0) > 0 && (
          <span className="tl-sub" title={`Waits on ${task.after!.length} task${task.after!.length === 1 ? "" : "s"}`}>
            <Link2 size={12} />
          </span>
        )}
        {late && (
          <span className="tl-warn" title="Starts before a task it waits on is due">
            <TriangleAlert size={13} />
          </span>
        )}
      </div>
      <div
        className="tl-track"
        data-empty={!start || undefined}
        onClick={(e) => {
          if (start) return;
          const left = e.currentTarget.getBoundingClientRect().left;
          onSchedule(project, task, addDays(geometry.start, Math.floor((e.clientX - left) / geometry.ppd)));
        }}
        title={start ? undefined : "Click a day to schedule it"}
      >
        {was && <span className="tl-ghost" style={{ left: geometry.x(was.start), width: (daysBetween(was.start, was.due) + 1) * geometry.ppd }} />}
        {start && due && (
          <button
            type="button"
            className={task.milestone ? "tl-milestone" : "tl-bar tl-bar-task"}
            data-done={task.done || undefined}
            data-overdue={overdue || undefined}
            data-critical={isCritical || undefined}
            data-dragging={preview ? true : undefined}
            style={
              task.milestone
                ? { left: geometry.x(due) + geometry.ppd / 2 }
                : { left: geometry.x(start), width: (daysBetween(start, due) + 1) * geometry.ppd }
            }
            title={`${task.title}: ${range}${task.estimateHours != null ? `, ${task.estimateHours}h` : ""}${overdue ? ", overdue" : ""}`}
            aria-label={`${task.title}, ${range}. Arrow keys move it a day; Shift and an arrow changes its length; Enter opens it.`}
            {...bind("move")}
            onKeyDown={(e) => {
              const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
              if (step && task.start && task.due) {
                e.preventDefault();
                if (e.shiftKey && !task.milestone) onResizeTask(project, task, "due", addDays(task.due, step));
                else onMoveTask(project, task, addDays(task.start, step), addDays(task.due, step));
              } else if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onOpenTask(project, task);
              }
            }}
          >
            {!task.milestone && (
              <>
                <span className="tl-handle" data-edge="start" {...bind("start")} aria-hidden />
                <span className="tl-bar-text truncate">{geometry.ppd * (daysBetween(start, due) + 1) > 60 ? task.title : ""}</span>
                <span className="tl-handle" data-edge="due" {...bind("due")} aria-hidden />
              </>
            )}
          </button>
        )}
        {!start && <span className="tl-unscheduled small muted">No date: click a day</span>}
      </div>
    </>
  );
}

function AddRow({ project, span }: { project: Project; span: PhaseSpan }) {
  const { addTask, toast } = useStudio();
  const [title, setTitle] = useState<string | null>(null);
  if (title === null) {
    return (
      <div className="tl-label tl-indent-2">
        <button type="button" className="tl-add small" onClick={() => setTitle("")}>
          <Plus size={13} /> Add task
        </button>
      </div>
    );
  }
  const phase = getWorkflow(project).phases.find((p) => p.key === span.key);
  return (
    <form
      className="tl-label tl-indent-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim()) return setTitle(null);
        addTask(project.id, { phaseKey: span.key, title: title.trim(), due: span.start });
        toast(`Added to ${phase?.name ?? "the phase"}`);
        setTitle("");
      }}
    >
      <input
        className="input tl-add-input"
        autoFocus
        value={title}
        maxLength={500}
        placeholder="Task, then Enter"
        aria-label={`New task in ${span.name}`}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => !title.trim() && setTitle(null)}
        onKeyDown={(e) => e.key === "Escape" && setTitle(null)}
      />
    </form>
  );
}
