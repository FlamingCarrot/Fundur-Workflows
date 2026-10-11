import { z } from "zod";
import { DEFAULT_WORK_WEEK, workWeekInput, type WorkWeek } from "./workweek";

/**
 * Someone's own planning, beside the projects: to-dos that belong to no
 * project, the lists they sort them into, the Kanban board's columns and where
 * each card sits, and their working week.
 *
 * It changes only through `applyPlannerOp`, a pure function, so the browser
 * (in the demo), the server and the assistant all change it the same way.
 */

export interface TodoList {
  id: string;
  name: string;
}

export interface Todo {
  id: string;
  /** The list it is on; null for the main to-do list. */
  listId: string | null;
  title: string;
  notes?: string;
  /** YYYY-MM-DD */
  due?: string;
  done: boolean;
  createdAt: string;
  doneAt?: string;
}

export interface BoardColumn {
  id: string;
  name: string;
  /** Cards moved here are marked done; cards marked done land here. */
  done: boolean;
}

/** Where a card sits; cards never placed sit in the first column, or the done column once done. */
export interface CardPlace {
  columnId: string;
  /** Sort key within the column; smaller is higher. */
  order: number;
}

export interface PlannerState {
  lists: TodoList[];
  todos: Todo[];
  columns: BoardColumn[];
  /** By card ref: see `todoRef` and `taskRef`. */
  cards: Record<string, CardPlace>;
  workWeek: WorkWeek;
}

export const DEFAULT_COLUMNS: BoardColumn[] = [
  { id: "todo", name: "To do", done: false },
  { id: "doing", name: "Doing", done: false },
  { id: "done", name: "Done", done: true },
];

export function emptyPlanner(workWeek: WorkWeek = DEFAULT_WORK_WEEK): PlannerState {
  return { lists: [], todos: [], columns: DEFAULT_COLUMNS, cards: {}, workWeek };
}

/** Fills in anything an older saved state lacks. */
export function normalizePlanner(raw: Partial<PlannerState> | null | undefined): PlannerState {
  const base = emptyPlanner();
  if (!raw || typeof raw !== "object") return base;
  const week = workWeekInput.safeParse(raw.workWeek);
  return {
    lists: Array.isArray(raw.lists) ? raw.lists : [],
    todos: Array.isArray(raw.todos) ? raw.todos : [],
    columns: Array.isArray(raw.columns) && raw.columns.length ? raw.columns : base.columns,
    cards: raw.cards && typeof raw.cards === "object" ? raw.cards : {},
    workWeek: week.success ? week.data : base.workWeek,
  };
}

export const todoRef = (todoId: string) => `todo:${todoId}`;
export const taskRef = (projectId: string, taskId: string) => `task:${projectId}:${taskId}`;

export class PlannerError extends Error {}

const id = z.string().min(1).max(100);
const name = z.string().trim().min(1, "Give it a name").max(120);
const title = z.string().trim().min(1, "Say what needs doing").max(500);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const ref = z.string().regex(/^(todo:[\w-]{1,100}|task:[\w-]{1,100}:[\w-]{1,100})$/);

export const plannerOp = z.discriminatedUnion("type", [
  z.object({ type: z.literal("addList"), id, name }),
  z.object({ type: z.literal("renameList"), id, name }),
  // Its to-dos go with it.
  z.object({ type: z.literal("removeList"), id }),
  z.object({
    type: z.literal("addTodo"),
    id,
    title,
    listId: id.nullable().optional(),
    due: day.nullable().optional(),
    notes: z.string().max(4000).optional(),
    at: z.string().optional(),
  }),
  z.object({
    type: z.literal("updateTodo"),
    id,
    title: title.optional(),
    listId: id.nullable().optional(),
    // null clears the date; leaving it out keeps it.
    due: day.nullable().optional(),
    notes: z.string().max(4000).optional(),
    done: z.boolean().optional(),
    at: z.string().optional(),
  }),
  z.object({ type: z.literal("removeTodo"), id }),
  z.object({ type: z.literal("addColumn"), id, name, done: z.boolean().optional() }),
  z.object({ type: z.literal("updateColumn"), id, name: name.optional(), done: z.boolean().optional() }),
  // Its cards move to the first column left.
  z.object({ type: z.literal("removeColumn"), id }),
  z.object({ type: z.literal("moveColumn"), id, index: z.number().int().min(0) }),
  // `index` is the position among the column's cards as shown, after the move.
  z.object({ type: z.literal("placeCard"), ref, columnId: id, index: z.number().int().min(0), shown: z.array(ref).max(2000) }),
  z.object({ type: z.literal("forgetCard"), ref }),
  z.object({ type: z.literal("setWorkWeek"), workWeek: workWeekInput }),
]);

export type PlannerOp = z.infer<typeof plannerOp>;

const MAX_TODOS = 5_000;
const MAX_LISTS = 100;
const MAX_COLUMNS = 12;

/** The column a card is in: where it was put, else by whether it is done. */
export function columnFor(state: PlannerState, cardRef: string, done: boolean): BoardColumn {
  const placed = state.cards[cardRef];
  const column = placed && state.columns.find((c) => c.id === placed.columnId);
  // A placed card that is now done (ticked elsewhere) shows as done, and one reopened leaves the done column.
  if (column && column.done === done) return column;
  return (done ? state.columns.find((c) => c.done) : state.columns.find((c) => !c.done)) ?? state.columns[0];
}

function findTodo(state: PlannerState, todoId: string): Todo {
  const todo = state.todos.find((t) => t.id === todoId);
  if (!todo) throw new PlannerError("That to-do no longer exists");
  return todo;
}

function checkList(state: PlannerState, listId: string | null | undefined) {
  if (listId && !state.lists.some((l) => l.id === listId)) throw new PlannerError("That list no longer exists");
}

function withDone(todo: Todo, done: boolean, at: string): Todo {
  const next: Todo = { ...todo, done };
  if (done) next.doneAt = at;
  else delete next.doneAt;
  return next;
}

/** The state after one change. Throws PlannerError when the change does not fit. */
export function applyPlannerOp(state: PlannerState, op: PlannerOp, now = new Date().toISOString()): PlannerState {
  switch (op.type) {
    case "addList":
      if (state.lists.some((l) => l.id === op.id)) return state;
      if (state.lists.length >= MAX_LISTS) throw new PlannerError(`Keep at most ${MAX_LISTS} lists`);
      return { ...state, lists: [...state.lists, { id: op.id, name: op.name }] };
    case "renameList":
      if (!state.lists.some((l) => l.id === op.id)) throw new PlannerError("That list no longer exists");
      return { ...state, lists: state.lists.map((l) => (l.id === op.id ? { ...l, name: op.name } : l)) };
    case "removeList": {
      const gone = new Set(state.todos.filter((t) => t.listId === op.id).map((t) => todoRef(t.id)));
      return {
        ...state,
        lists: state.lists.filter((l) => l.id !== op.id),
        todos: state.todos.filter((t) => t.listId !== op.id),
        cards: Object.fromEntries(Object.entries(state.cards).filter(([r]) => !gone.has(r))),
      };
    }
    case "addTodo": {
      if (state.todos.some((t) => t.id === op.id)) return state;
      if (state.todos.length >= MAX_TODOS) throw new PlannerError("Clear some done to-dos first");
      checkList(state, op.listId);
      const todo: Todo = {
        id: op.id,
        listId: op.listId ?? null,
        title: op.title,
        done: false,
        createdAt: op.at ?? now,
        ...(op.due ? { due: op.due } : {}),
        ...(op.notes ? { notes: op.notes } : {}),
      };
      return { ...state, todos: [...state.todos, todo] };
    }
    case "updateTodo": {
      const current = findTodo(state, op.id);
      if (op.listId !== undefined) checkList(state, op.listId);
      const next: Todo = { ...current };
      if (op.title !== undefined) next.title = op.title;
      if (op.listId !== undefined) next.listId = op.listId;
      if (op.notes !== undefined) {
        if (op.notes) next.notes = op.notes;
        else delete next.notes;
      }
      if (op.due !== undefined) {
        if (op.due) next.due = op.due;
        else delete next.due;
      }
      const saved = op.done !== undefined && op.done !== current.done ? withDone(next, op.done, op.at ?? now) : next;
      return { ...state, todos: state.todos.map((t) => (t.id === op.id ? saved : t)) };
    }
    case "removeTodo": {
      const cards = { ...state.cards };
      delete cards[todoRef(op.id)];
      return { ...state, todos: state.todos.filter((t) => t.id !== op.id), cards };
    }
    case "addColumn":
      if (state.columns.some((c) => c.id === op.id)) return state;
      if (state.columns.length >= MAX_COLUMNS) throw new PlannerError(`Keep at most ${MAX_COLUMNS} columns`);
      return { ...state, columns: [...state.columns, { id: op.id, name: op.name, done: !!op.done }] };
    case "updateColumn":
      if (!state.columns.some((c) => c.id === op.id)) throw new PlannerError("That column no longer exists");
      return {
        ...state,
        columns: state.columns.map((c) =>
          c.id === op.id ? { ...c, ...(op.name !== undefined ? { name: op.name } : {}), ...(op.done !== undefined ? { done: op.done } : {}) } : c
        ),
      };
    case "removeColumn": {
      if (state.columns.length <= 1) throw new PlannerError("A board needs at least one column");
      const columns = state.columns.filter((c) => c.id !== op.id);
      // Cards placed there go back to where their done state puts them.
      const cards = Object.fromEntries(Object.entries(state.cards).filter(([, p]) => p.columnId !== op.id));
      return { ...state, columns, cards };
    }
    case "moveColumn": {
      const from = state.columns.findIndex((c) => c.id === op.id);
      if (from < 0) throw new PlannerError("That column no longer exists");
      const columns = [...state.columns];
      const [moved] = columns.splice(from, 1);
      columns.splice(Math.min(op.index, columns.length), 0, moved);
      return { ...state, columns };
    }
    case "placeCard": {
      if (!state.columns.some((c) => c.id === op.columnId)) throw new PlannerError("That column no longer exists");
      // Renumber the column as shown, with the card at its new place, so the order survives cards that come and go.
      const order = op.shown.filter((r) => r !== op.ref);
      order.splice(Math.min(op.index, order.length), 0, op.ref);
      const cards = { ...state.cards };
      order.forEach((r, i) => {
        cards[r] = { columnId: op.columnId, order: i };
      });
      let todos = state.todos;
      // Moving one of their own to-dos into or out of a done column ticks it or opens it again.
      const column = state.columns.find((c) => c.id === op.columnId)!;
      if (op.ref.startsWith("todo:")) {
        const todoId = op.ref.slice(5);
        todos = todos.map((t) => (t.id === todoId && t.done !== column.done ? withDone(t, column.done, now) : t));
      }
      return { ...state, cards, todos };
    }
    case "forgetCard": {
      const cards = { ...state.cards };
      delete cards[op.ref];
      return { ...state, cards };
    }
    case "setWorkWeek":
      return { ...state, workWeek: op.workWeek };
  }
}
