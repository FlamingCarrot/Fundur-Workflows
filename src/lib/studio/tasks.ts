import { getWorkflow } from "@/lib/workflow";
import { addDays, shiftForPhase } from "./timeline";
import type { ChecklistItem } from "@/lib/workflow/schema";
import type { Project, TaskRecord } from "./types";

/**
 * Tasks as the designer sees them (P2-01 to P2-03): every checklist step of
 * the workflow, plus the tasks she added herself. A step's title comes from the
 * workflow and its done state from the checklist tick, so ticking a step on the
 * phase screen moves its task with it. Dates and outputs she set are kept on
 * the project and win over the workflow's own date.
 */

const DAY = 86_400_000;

export interface Task {
  /** A step's id is its checklist item id; a task of her own has its own. */
  id: string;
  title: string;
  projectId: string;
  phaseKey: string;
  /** "step" comes from the workflow definition; "own" she added. */
  source: "step" | "own";
  done: boolean;
  essential: boolean;
  /** The day it is due, as YYYY-MM-DD; absent when it has none. */
  due?: string;
  /** True when she moved the date off the workflow's own. */
  dateMoved: boolean;
  outputDocumentId?: string;
  /** The task record behind it, when there is one. */
  recordId?: string;
}

export function toDay(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

export function dayToDate(day: string): Date {
  return new Date(`${day}T00:00:00`);
}

/**
 * The day a step is due before she moves it: so many days after the project
 * started, plus however far its phase has been moved on the timeline.
 */
export function stepDueDay(project: Project, item: ChecklistItem, phaseKey: string): string | undefined {
  if (item.relativeDaysDue == null) return undefined;
  const planned = toDay(new Date(new Date(project.startDate).getTime() + item.relativeDaysDue * DAY));
  const shift = shiftForPhase(project, phaseKey);
  return shift ? addDays(planned, shift) : planned;
}

function recordFor(project: Project, itemId: string): TaskRecord | undefined {
  return project.tasks.find((t) => t.stepItemId === itemId);
}

/** Every task on a project: its workflow steps and the tasks she added. */
export function projectTasks(project: Project): Task[] {
  const tasks: Task[] = [];
  for (const phase of getWorkflow(project).phases) {
    for (const item of phase.checklist) {
      const record = recordFor(project, item.id);
      const defaultDue = stepDueDay(project, item, phase.key);
      const due = record?.due ?? defaultDue;
      tasks.push({
        id: item.id,
        title: item.text,
        projectId: project.id,
        phaseKey: phase.key,
        source: "step",
        done: !!project.checks[item.id],
        essential: item.essential,
        ...(due ? { due } : {}),
        dateMoved: !!record?.due && record.due !== defaultDue,
        ...(record?.outputDocumentId ? { outputDocumentId: record.outputDocumentId } : {}),
        ...(record ? { recordId: record.id } : {}),
      });
    }
  }
  for (const record of project.tasks) {
    if (record.stepItemId) continue;
    tasks.push({
      id: record.id,
      title: record.title,
      projectId: project.id,
      phaseKey: record.phaseKey,
      source: "own",
      done: record.done,
      essential: false,
      ...(record.due ? { due: record.due } : {}),
      dateMoved: false,
      ...(record.outputDocumentId ? { outputDocumentId: record.outputDocumentId } : {}),
      recordId: record.id,
    });
  }
  return tasks.sort(byDue);
}

/** Soonest first; anything without a date comes last. */
export function byDue(a: Task, b: Task): number {
  if (a.due && b.due && a.due !== b.due) return a.due < b.due ? -1 : 1;
  if (a.due !== b.due) return a.due ? -1 : 1;
  return a.title.localeCompare(b.title);
}

export interface ProjectTask extends Task {
  project: Project;
}

/** Open tasks across every active project, soonest first (P2-07). */
export function openTasks(projects: Project[]): ProjectTask[] {
  const all: ProjectTask[] = [];
  for (const project of projects) {
    if (project.status !== "active") continue;
    for (const task of projectTasks(project)) {
      if (task.done) continue;
      all.push({ ...task, project });
    }
  }
  return all.sort(byDue);
}

export type DueGroup = "overdue" | "today" | "this_week" | "later" | "no_date";

export const DUE_GROUP_LABEL: Record<DueGroup, string> = {
  overdue: "Overdue",
  today: "Today",
  this_week: "This week",
  later: "Later",
  no_date: "No date",
};

export function dueGroup(task: Pick<Task, "due">, today = toDay(new Date())): DueGroup {
  if (!task.due) return "no_date";
  if (task.due < today) return "overdue";
  if (task.due === today) return "today";
  const inSeven = toDay(new Date(dayToDate(today).getTime() + 7 * DAY));
  return task.due <= inSeven ? "this_week" : "later";
}

/** Open tasks across projects, in the groups the due list shows (P2-07). */
export function groupByDue(tasks: ProjectTask[], today = toDay(new Date())): { group: DueGroup; tasks: ProjectTask[] }[] {
  const order: DueGroup[] = ["overdue", "today", "this_week", "later", "no_date"];
  return order
    .map((group) => ({ group, tasks: tasks.filter((t) => dueGroup(t, today) === group) }))
    .filter((g) => g.tasks.length > 0);
}
