import { getWorkflow } from "@/lib/workflow";
import { addDays, daysBetween, phaseSpans } from "./timeline";
import { dayToDate, projectTasks, toDay, type Task } from "./tasks";
import type { Baseline, Project, TaskRecord } from "./types";

/**
 * Planning on the timeline: tasks that run over days, tasks that wait on
 * others, milestones, a saved baseline, the critical path and the workload.
 *
 * Everything here is a pure function of a project, so the browser, the server
 * and the assistant all reach the same answer. A change is expressed as one of
 * the plan mutations below; `applyPlanMutation` applies it to a project in the
 * browser and the server store writes the same thing to the database.
 */

/**
 * A task's dates as she set them. null clears what she set: a workflow step
 * goes back to the workflow's own date, a task of her own has no date.
 */
export interface ScheduleChange {
  taskId: string;
  start: string | null;
  due: string | null;
}

export interface TaskPlan {
  after: string[];
  milestone: boolean;
  estimateHours: number | null;
}

/** The plan changes the timeline makes, as the browser sends them to the server. */
export type PlanMutation =
  | { type: "scheduleTasks"; changes: ScheduleChange[] }
  | ({ type: "setTaskPlan"; taskId: string } & TaskPlan)
  | { type: "setBaseline"; save: boolean }
  | { type: "shiftProject"; days: number };

export class PlanError extends Error {}

/** A task with the dates it is drawn on: start and due are both set or both absent. */
export function taskById(project: Project, taskId: string): Task | undefined {
  return projectTasks(project).find((t) => t.id === taskId);
}

/** The phase a workflow step belongs to, or undefined when the id is not a step. */
export function stepPhase(project: Project, taskId: string): string | undefined {
  return getWorkflow(project).phases.find((ph) => ph.checklist.some((i) => i.id === taskId))?.key;
}

/** The days a task covers, counting both ends. */
export function taskDays(task: Pick<Task, "start" | "due">): number {
  return task.start && task.due ? daysBetween(task.start, task.due) + 1 : 0;
}

// ---------- Moving tasks, and the tasks that wait on them ----------

/** Tasks that wait on each task: the reverse of `after`. */
function successors(tasks: Task[]): Map<string, Task[]> {
  const map = new Map<string, Task[]>();
  for (const task of tasks) {
    for (const id of task.after ?? []) {
      if (!map.has(id)) map.set(id, []);
      map.get(id)!.push(task);
    }
  }
  return map;
}

/**
 * Moves a task to new days and pushes every task that waits on it, and the
 * ones that wait on those, so none starts before what it waits on is due.
 * Waiting tasks are only ever pushed later, never pulled earlier, and each
 * keeps its length. Returns the changes to save, the moved task first.
 */
export function planMove(project: Project, taskId: string, start: string, due: string): ScheduleChange[] {
  const tasks = projectTasks(project);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  if (!byId.has(taskId)) throw new PlanError("No such task");
  if (start > due) [start, due] = [due, start];
  const next = new Map([[taskId, { start, due }]]);
  const after = successors(tasks);

  const queue = [taskId];
  // Links never form a loop, but a bad record must not hang the browser.
  for (let guard = 0; queue.length && guard < 10_000; guard++) {
    const id = queue.shift()!;
    const { due: predecessorDue } = next.get(id)!;
    for (const waiting of after.get(id) ?? []) {
      const current = next.get(waiting.id) ?? (waiting.start && waiting.due ? { start: waiting.start, due: waiting.due } : null);
      if (!current) continue;
      const earliest = addDays(predecessorDue, 1);
      if (current.start >= earliest) continue;
      const delta = daysBetween(current.start, earliest);
      next.set(waiting.id, { start: earliest, due: addDays(current.due, delta) });
      queue.push(waiting.id);
    }
  }

  return [...next].map(([id, days]) => ({ taskId: id, start: days.start === days.due ? null : days.start, due: days.due }));
}

/** Changes a task's start or due day alone, keeping the other end, and pushes what waits on it. */
export function planResize(project: Project, taskId: string, edge: "start" | "due", day: string): ScheduleChange[] {
  const task = taskById(project, taskId);
  if (!task?.start || !task.due) throw new PlanError("That task has no dates yet");
  if (edge === "start") return planMove(project, taskId, day > task.due ? task.due : day, task.due);
  return planMove(project, taskId, task.start, day < task.start ? task.start : day);
}

/** True when making `taskId` wait on `after` would make some task wait on itself. */
export function wouldLoop(project: Project, taskId: string, after: string[]): boolean {
  const tasks = projectTasks(project);
  const links = new Map(tasks.map((t) => [t.id, t.id === taskId ? after : (t.after ?? [])]));
  const seen = new Set<string>();
  const stack = [...after];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === taskId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(links.get(id) ?? []));
  }
  return false;
}

export interface Conflict {
  /** The task waited on. */
  from: string;
  /** The task that starts too early. */
  to: string;
}

/** Links where the waiting task starts on or before the day what it waits on is due. */
export function linkConflicts(project: Project): Conflict[] {
  const tasks = projectTasks(project);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const conflicts: Conflict[] = [];
  for (const task of tasks) {
    if (!task.start || task.done) continue;
    for (const id of task.after ?? []) {
      const before = byId.get(id);
      if (before?.due && !before.done && task.start <= before.due) conflicts.push({ from: id, to: task.id });
    }
  }
  return conflicts;
}

// ---------- Critical path ----------

/**
 * The open tasks that decide when the project ends: any of them slipping by a
 * day moves the last day. A task is on it when it has no slack, counting back
 * from the project's last due day through the tasks that wait on it.
 */
export function criticalPath(project: Project): Set<string> {
  const tasks = projectTasks(project).filter((t) => !t.done && t.start && t.due);
  if (!tasks.length) return new Set();
  const end = tasks.reduce((max, t) => (t.due! > max ? t.due! : max), tasks[0].due!);
  const after = successors(tasks);
  const latestFinish = new Map<string, string>();

  const finish = (task: Task, depth = 0): string => {
    const known = latestFinish.get(task.id);
    if (known) return known;
    let latest = end;
    if (depth < 500) {
      for (const next of after.get(task.id) ?? []) {
        // The waiting task must start the day after this one is due.
        const nextLatestStart = addDays(finish(next, depth + 1), -(taskDays(next) - 1));
        const mustBeDue = addDays(nextLatestStart, -1);
        if (mustBeDue < latest) latest = mustBeDue;
      }
    }
    latestFinish.set(task.id, latest);
    return latest;
  };

  return new Set(tasks.filter((t) => finish(t) <= t.due!).map((t) => t.id));
}

// ---------- Baseline ----------

/** The plan as it stands now, to keep as the baseline. */
export function captureBaseline(project: Project, now = new Date()): Baseline {
  const phases: Baseline["phases"] = {};
  for (const span of phaseSpans(project)) phases[span.key] = { start: span.start, end: span.end };
  const tasks: Baseline["tasks"] = {};
  for (const task of projectTasks(project)) {
    if (task.start && task.due) tasks[task.id] = { start: task.start, due: task.due };
  }
  return { savedAt: now.toISOString(), phases, tasks };
}

/** How many days each task and the project's end have slipped since the baseline; later is positive. */
export function baselineSlip(project: Project): { endDays: number; tasks: Record<string, number> } | null {
  const baseline = project.baseline;
  if (!baseline) return null;
  const tasks: Record<string, number> = {};
  for (const task of projectTasks(project)) {
    const before = baseline.tasks[task.id];
    if (before && task.due) tasks[task.id] = daysBetween(before.due, task.due);
  }
  const was = Object.values(baseline.phases).reduce((max, p) => (p.end > max ? p.end : max), "");
  const spans = phaseSpans(project);
  const now = spans.reduce((max, s) => (s.end > max ? s.end : max), "");
  return { endDays: was && now ? daysBetween(was, now) : 0, tasks };
}

// ---------- Shifting a whole project ----------

/** Every phase, and every date she set, moved by the same number of days. */
export function planShift(project: Project, days: number): { phaseDates: Record<string, string>; changes: ScheduleChange[] } {
  const phaseDates: Record<string, string> = {};
  for (const span of phaseSpans(project)) phaseDates[span.key] = addDays(span.start, days);
  const changes: ScheduleChange[] = [];
  for (const record of project.tasks) {
    if (!record.start && !record.due) continue;
    changes.push({
      taskId: record.stepItemId ?? record.id,
      start: record.start ? addDays(record.start, days) : null,
      due: record.due ? addDays(record.due, days) : null,
    });
  }
  return { phaseDates, changes };
}

// ---------- Applying a change in the browser ----------

function withRecord(project: Project, taskId: string, patch: Partial<TaskRecord>): Project {
  const phaseKey = stepPhase(project, taskId);
  const existing = project.tasks.find((t) => (phaseKey ? t.stepItemId === taskId : t.id === taskId && !t.stepItemId));
  if (existing) return { ...project, tasks: project.tasks.map((t) => (t === existing ? clean({ ...t, ...patch }) : t)) };
  if (!phaseKey) throw new PlanError("No such task");
  const record: TaskRecord = { id: `step-${taskId}`, stepItemId: taskId, phaseKey, title: "", done: false };
  return { ...project, tasks: [...project.tasks, clean({ ...record, ...patch })] };
}

/** Drops fields set to undefined, so a cleared date reads as absent. */
function clean(record: TaskRecord): TaskRecord {
  return Object.fromEntries(Object.entries(record).filter(([, v]) => v !== undefined)) as unknown as TaskRecord;
}

/** Checks a change against the project; throws a PlanError saying what is wrong. */
export function validatePlanMutation(project: Project, m: PlanMutation): void {
  const exists = (id: string) => !!taskById(project, id);
  switch (m.type) {
    case "scheduleTasks":
      for (const c of m.changes) {
        if (!exists(c.taskId)) throw new PlanError(`No such task '${c.taskId}'`);
        if (c.start && c.due && c.start > c.due) throw new PlanError("A task cannot start after it is due");
        if (c.start && !c.due && !stepPhase(project, c.taskId)) throw new PlanError("A task with a start needs a due day");
      }
      return;
    case "setTaskPlan":
      if (!exists(m.taskId)) throw new PlanError(`No such task '${m.taskId}'`);
      for (const id of m.after) if (!exists(id)) throw new PlanError(`No such task '${id}'`);
      if (wouldLoop(project, m.taskId, m.after)) throw new PlanError("A task cannot wait on itself, even through others");
      return;
    case "setBaseline":
    case "shiftProject":
      return;
  }
}

/** The project after a plan change, as the browser shows it before the server confirms. */
export function applyPlanMutation(project: Project, m: PlanMutation, now = new Date()): Project {
  switch (m.type) {
    case "scheduleTasks":
      return m.changes.reduce(
        (p, c) => withRecord(p, c.taskId, { start: c.start ?? undefined, due: c.due ?? undefined }),
        project
      );
    case "setTaskPlan":
      return withRecord(project, m.taskId, {
        after: m.after.length ? m.after : undefined,
        milestone: m.milestone || undefined,
        estimateHours: m.estimateHours ?? undefined,
      });
    case "setBaseline": {
      if (m.save) return { ...project, baseline: captureBaseline(project, now) };
      const next = { ...project };
      delete next.baseline;
      return next;
    }
    case "shiftProject": {
      const { phaseDates, changes } = planShift(project, m.days);
      return applyPlanMutation({ ...project, phaseDates }, { type: "scheduleTasks", changes }, now);
    }
  }
}

/** The change that puts the given tasks back the way they are in this project, for undo. */
export function undoSchedule(project: Project, changes: ScheduleChange[]): PlanMutation {
  return {
    type: "scheduleTasks",
    changes: changes.map((c) => {
      const phaseKey = stepPhase(project, c.taskId);
      const record = project.tasks.find((t) => (phaseKey ? t.stepItemId === c.taskId : t.id === c.taskId));
      return { taskId: c.taskId, start: record?.start ?? null, due: record?.due ?? null };
    }),
  };
}

// ---------- Workload ----------

/** A task with no estimate counts as this many hours. */
export const DEFAULT_TASK_HOURS = 1;
/** Hours of work a weekday holds, until working hours are set. */
export const DAY_CAPACITY_HOURS = 8;

export function isWeekend(day: string): boolean {
  const d = dayToDate(day).getDay();
  return d === 0 || d === 6;
}

export interface WorkloadDay {
  day: string;
  hours: number;
  tasks: number;
  capacity: number;
}

/**
 * Hours of open work planned on each day from `from` to `to`, across the
 * projects given. A task's hours are spread evenly over the weekdays it runs
 * (over every day when it runs only at a weekend).
 */
export function workload(projects: Project[], from: string, to: string): WorkloadDay[] {
  const days = new Map<string, WorkloadDay>();
  for (let d = from; d <= to; d = addDays(d, 1)) {
    days.set(d, { day: d, hours: 0, tasks: 0, capacity: isWeekend(d) ? 0 : DAY_CAPACITY_HOURS });
  }
  for (const project of projects) {
    if (project.status !== "active") continue;
    for (const task of projectTasks(project)) {
      if (task.done || !task.start || !task.due || task.milestone) continue;
      const span: string[] = [];
      for (let d = task.start; d <= task.due; d = addDays(d, 1)) span.push(d);
      const working = span.filter((d) => !isWeekend(d));
      const spread = working.length ? working : span;
      const each = (task.estimateHours ?? DEFAULT_TASK_HOURS) / spread.length;
      for (const d of spread) {
        const day = days.get(d);
        if (!day) continue;
        day.hours += each;
        day.tasks += 1;
      }
    }
  }
  return [...days.values()];
}

/** The same, summed by week (each week keyed by its Monday). */
export function weeklyWorkload(daily: WorkloadDay[]): WorkloadDay[] {
  const weeks = new Map<string, WorkloadDay>();
  for (const d of daily) {
    const date = dayToDate(d.day);
    const monday = toDay(new Date(date.getTime() - ((date.getDay() + 6) % 7) * 86_400_000));
    const week = weeks.get(monday) ?? { day: monday, hours: 0, tasks: 0, capacity: 0 };
    week.hours += d.hours;
    week.tasks += d.tasks;
    week.capacity += d.capacity;
    weeks.set(monday, week);
  }
  return [...weeks.values()];
}

// ---------- Export ----------

function csvCell(value: string | number | boolean | undefined): string {
  const text = value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Every task of the projects as CSV, for a spreadsheet. */
export function timelineCsv(projects: Project[]): string {
  const rows = [["Project", "Client", "Phase", "Task", "Start", "Due", "Days", "Milestone", "Done", "Waits on", "Estimate (h)"]];
  for (const project of projects) {
    const phases = new Map(getWorkflow(project).phases.map((p) => [p.key, p.name]));
    const tasks = projectTasks(project);
    const titles = new Map(tasks.map((t) => [t.id, t.title]));
    for (const task of tasks) {
      rows.push([
        project.name,
        project.client,
        phases.get(task.phaseKey) ?? task.phaseKey,
        task.title,
        task.start ?? "",
        task.due ?? "",
        String(taskDays(task) || ""),
        task.milestone ? "yes" : "",
        task.done ? "yes" : "",
        (task.after ?? []).map((id) => titles.get(id) ?? id).join("; "),
        task.estimateHours != null ? String(task.estimateHours) : "",
      ]);
    }
  }
  return rows.map((r) => r.map(csvCell).join(",")).join("\n");
}
