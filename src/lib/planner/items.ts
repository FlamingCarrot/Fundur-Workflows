import { projectTasks, type ProjectTask } from "@/lib/studio/tasks";
import type { Project } from "@/lib/studio/types";
import { columnFor, taskRef, todoRef, type BoardColumn, type PlannerState, type Todo, type TodoList } from "./state";

/**
 * Everything on someone's plate in one shape: project tasks (workflow steps
 * and tasks added to a project) and their own to-dos. The to-do list, the
 * board, the calendar and the calendar feed all read from this.
 */

interface ItemBase {
  /** The card ref the board keys it by. */
  ref: string;
  title: string;
  /** YYYY-MM-DD */
  due?: string;
  done: boolean;
}

export type PlanItem = (ItemBase & { kind: "task"; task: ProjectTask }) | (ItemBase & { kind: "todo"; todo: Todo; list?: TodoList });

/** Which items to show: everything, project tasks only, the main to-do list, or one list. */
export type ItemScope = "all" | "projects" | "mine" | { listId: string };

export function scopeKey(scope: ItemScope): string {
  return typeof scope === "string" ? scope : `list:${scope.listId}`;
}

export function parseScope(key: string, planner: PlannerState): ItemScope {
  if (key === "all" || key === "projects" || key === "mine") return key;
  const listId = key.startsWith("list:") ? key.slice(5) : "";
  return planner.lists.some((l) => l.id === listId) ? { listId } : "all";
}

/** Items across active projects and the planner, soonest first; anything without a date last. */
export function planItems(projects: Project[], planner: PlannerState, scope: ItemScope = "all"): PlanItem[] {
  const items: PlanItem[] = [];
  if (scope === "all" || scope === "projects") {
    for (const project of projects) {
      if (project.status !== "active") continue;
      for (const task of projectTasks(project)) {
        items.push({ kind: "task", ref: taskRef(project.id, task.id), title: task.title, due: task.due, done: task.done, task: { ...task, project } });
      }
    }
  }
  if (scope !== "projects") {
    const lists = new Map(planner.lists.map((l) => [l.id, l]));
    for (const todo of planner.todos) {
      if (scope === "mine" && todo.listId) continue;
      if (typeof scope === "object" && todo.listId !== scope.listId) continue;
      const list = todo.listId ? lists.get(todo.listId) : undefined;
      items.push({ kind: "todo", ref: todoRef(todo.id), title: todo.title, due: todo.due, done: todo.done, todo, ...(list ? { list } : {}) });
    }
  }
  return items.sort(byDue);
}

export function byDue(a: Pick<PlanItem, "due" | "title">, b: Pick<PlanItem, "due" | "title">): number {
  if (a.due && b.due && a.due !== b.due) return a.due < b.due ? -1 : 1;
  if (a.due !== b.due) return a.due ? -1 : 1;
  return a.title.localeCompare(b.title);
}

export interface BoardLane {
  column: BoardColumn;
  items: PlanItem[];
}

/** The board's columns with their cards in order: placed cards first by their order, the rest by date. */
export function boardLanes(planner: PlannerState, items: PlanItem[]): BoardLane[] {
  const lanes = new Map(planner.columns.map((c) => [c.id, [] as PlanItem[]]));
  for (const item of items) lanes.get(columnFor(planner, item.ref, item.done).id)?.push(item);
  return planner.columns.map((column) => ({
    column,
    items: lanes.get(column.id)!.sort((a, b) => {
      const pa = planner.cards[a.ref]?.columnId === column.id ? planner.cards[a.ref].order : Infinity;
      const pb = planner.cards[b.ref]?.columnId === column.id ? planner.cards[b.ref].order : Infinity;
      return pa !== pb ? pa - pb : byDue(a, b);
    }),
  }));
}
