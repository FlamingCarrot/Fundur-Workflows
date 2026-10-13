import { z } from "zod";
import { listBookings } from "@/lib/planner/booking-store";
import { PlannerError, plannerOp, todoRef, type PlannerOp, type PlannerState } from "@/lib/planner/state";
import { changePlanner, getPlanner } from "@/lib/planner/store";
import { workWeekInput } from "@/lib/planner/workweek";
import { registerTool, type ToolContext } from "./registry";

/**
 * Her own planner for the assistant: to-do lists, the task board's columns
 * and cards, her working week and the bookings clients made. It is hers
 * alone, so the autopilot (which works on projects) never touches it.
 */

const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function describe(state: PlannerState): object {
  const lists = new Map(state.lists.map((l) => [l.id, l.name]));
  const columns = new Map(state.columns.map((c) => [c.id, c.name]));
  return {
    lists: state.lists,
    todos: state.todos
      .filter((t) => !t.done || (t.doneAt && Date.now() - Date.parse(t.doneAt) < 14 * 86_400_000))
      .slice(0, 200)
      .map((t) => ({
        id: t.id,
        title: t.title,
        list: t.listId ? lists.get(t.listId) ?? t.listId : "To-do list",
        due: t.due,
        done: t.done,
        notes: t.notes?.slice(0, 300),
        boardColumn: columns.get(state.cards[todoRef(t.id)]?.columnId ?? "") ?? undefined,
      })),
    boardColumns: state.columns,
    workWeek: state.workWeek,
  };
}

async function guard(ctx: ToolContext) {
  if (ctx.autopilot) return { content: "Her planner is hers; the autopilot works on the project.", isError: true as const };
  return null;
}

registerTool({
  name: "read_planner",
  module: "tasks_calendar",
  anywhere: true,
  label: "Reading her planner",
  description:
    "Reads her own planner: to-do lists and to-dos (with ids), the task board's columns and where her to-dos sit on it, her working week, and the bookings clients made for the next two weeks. Project steps and tasks are read with the project tools.",
  input: z.object({}),
  async run(ctx) {
    const no = await guard(ctx);
    if (no) return no;
    const { state } = await getPlanner(ctx.db, ctx.run.workspaceId, ctx.run.userId);
    const now = new Date();
    const bookings = await listBookings(ctx.db, ctx.run.workspaceId, ctx.run.userId, now, new Date(now.getTime() + 14 * 86_400_000));
    return { content: "Her planner, saved data:\n" + JSON.stringify({ ...describe(state), upcomingBookings: bookings.slice(0, 30) }) };
  },
});

const edit = z.discriminatedUnion("type", [
  z.object({ type: z.literal("addTodo"), title: z.string().trim().min(1).max(500), listId: z.string().max(100).nullable().optional(), due: day.nullable().optional(), notes: z.string().max(4000).optional() }),
  z.object({ type: z.literal("updateTodo"), id: z.string().max(100), title: z.string().trim().min(1).max(500).optional(), listId: z.string().max(100).nullable().optional(), due: day.nullable().optional(), notes: z.string().max(4000).optional(), done: z.boolean().optional() }),
  z.object({ type: z.literal("removeTodo"), id: z.string().max(100) }),
  z.object({ type: z.literal("addList"), name: z.string().trim().min(1).max(120) }),
  z.object({ type: z.literal("renameList"), id: z.string().max(100), name: z.string().trim().min(1).max(120) }),
  z.object({ type: z.literal("removeList"), id: z.string().max(100) }),
  z.object({ type: z.literal("addColumn"), name: z.string().trim().min(1).max(120), done: z.boolean().optional() }),
  z.object({ type: z.literal("updateColumn"), id: z.string().max(100), name: z.string().trim().min(1).max(120).optional(), done: z.boolean().optional() }),
  z.object({ type: z.literal("removeColumn"), id: z.string().max(100) }),
  z.object({ type: z.literal("moveColumn"), id: z.string().max(100), index: z.number().int().min(0).max(50) }),
  z.object({
    type: z.literal("moveCard"),
    todoId: z.string().max(100).optional().describe("One of her to-dos"),
    projectTask: z.object({ projectId: z.string().max(100), taskId: z.string().max(100) }).optional().describe("A project step or task, by project id (slug) and task id"),
    columnId: z.string().max(100),
    top: z.boolean().default(false),
  }),
  z.object({ type: z.literal("setWorkWeek"), days: z.array(z.number().int().min(0).max(6)).min(1).max(7).describe("0 is Sunday"), start: z.string().regex(/^\d{2}:\d{2}$/), end: z.string().regex(/^\d{2}:\d{2}$/), timeZone: z.string().max(64).optional() }),
]);

registerTool({
  name: "edit_planner",
  module: "tasks_calendar",
  anywhere: true,
  label: "Updating her planner",
  description:
    "Changes her own planner, as she would: add, change, tick, move or remove to-dos; add, rename or remove to-do lists; add, rename, reorder or remove board columns and move cards between them (moving into a done column ticks a to-do); set her working days and hours. Read the planner first for ids.",
  input: z.object({ changes: z.array(edit).min(1).max(40) }),
  async run(ctx, input) {
    const no = await guard(ctx);
    if (no) return no;
    const { state } = await getPlanner(ctx.db, ctx.run.workspaceId, ctx.run.userId);
    const ops: PlannerOp[] = [];
    const done: string[] = [];
    // Cards placed by earlier changes in this call count when placing the next.
    const cards = { ...state.cards };
    for (const c of input.changes) {
      switch (c.type) {
        case "addTodo":
          ops.push({ type: "addTodo", id: newId("todo"), title: c.title, listId: c.listId ?? null, due: c.due ?? null, notes: c.notes });
          done.push(`added "${c.title}"`);
          break;
        case "addList":
          ops.push({ type: "addList", id: newId("list"), name: c.name });
          done.push(`added list "${c.name}"`);
          break;
        case "addColumn":
          ops.push({ type: "addColumn", id: newId("col"), name: c.name, done: c.done });
          done.push(`added column "${c.name}"`);
          break;
        case "moveCard": {
          const ref = c.todoId ? todoRef(c.todoId) : c.projectTask ? `task:${c.projectTask.projectId}:${c.projectTask.taskId}` : null;
          if (!ref) return { content: "Say which to-do or project task to move.", isError: true };
          const shown = Object.entries(cards)
            .filter(([r, p]) => p.columnId === c.columnId && r !== ref)
            .sort((a, b) => a[1].order - b[1].order)
            .map(([r]) => r);
          ops.push({ type: "placeCard", ref, columnId: c.columnId, index: c.top ? 0 : shown.length, shown: [...shown, ref] });
          cards[ref] = { columnId: c.columnId, order: c.top ? -1 : shown.length };
          done.push("moved a card");
          break;
        }
        case "setWorkWeek": {
          const week = workWeekInput.safeParse({ days: c.days, start: c.start, end: c.end, timeZone: c.timeZone ?? state.workWeek.timeZone });
          if (!week.success) return { content: week.error.issues[0]?.message ?? "That working week doesn't fit.", isError: true };
          ops.push({ type: "setWorkWeek", workWeek: week.data });
          done.push("set the working week");
          break;
        }
        default: {
          const op = plannerOp.safeParse(c);
          if (!op.success) return { content: op.error.issues[0]?.message ?? "That change doesn't fit.", isError: true };
          ops.push(op.data);
          done.push(c.type.replace(/([A-Z])/g, " $1").toLowerCase());
        }
      }
    }
    try {
      await changePlanner(ctx.db, ctx.run.workspaceId, ctx.run.userId, ops);
    } catch (err) {
      if (err instanceof PlannerError) return { content: err.message, isError: true };
      throw err;
    }
    return { content: `Done in her planner: ${done.join(", ")}.` };
  },
});
