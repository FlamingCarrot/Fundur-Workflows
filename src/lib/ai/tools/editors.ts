import { z } from "zod";
import type { ProjectMutation } from "@/lib/projects/mutations";
import { criticalPath, planMove, PlanError, stepPhase, taskById } from "@/lib/studio/schedule";
import { projectTasks } from "@/lib/studio/tasks";
import { getWorkflow } from "@/lib/workflow";
import { newPhaseKey, newStepId, workflowChange, type WorkflowChange } from "@/lib/workflow/custom";
import { applyWhiteboardOp, listNotes } from "@/lib/team/store";
import { BOARD_HEIGHT, BOARD_WIDTH, NOTE_COLORS, whiteboardNoteSchema } from "@/lib/team/space";
import { registerTool } from "./registry";

/**
 * The editors a person uses beyond the plan: the timeline (dates, links,
 * milestones, estimates, the baseline), the project's settings and its own
 * workflow. Each tool makes the same change the editor makes, so it is
 * undone the same way.
 */

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

registerTool({
  name: "read_timeline",
  module: "tasks_calendar",
  label: "Reading the timeline",
  description:
    "Reads the project's timeline: every step and task with its id, phase, start and due days, what it waits on, whether it is a milestone, its estimate in hours, and which tasks are on the critical path. Read it before planning.",
  input: z.object({ phaseKey: z.string().max(100).optional() }),
  async run(ctx, input) {
    const critical = criticalPath(ctx.project);
    const phases = new Map(getWorkflow(ctx.project).phases.map((p) => [p.key, p.name]));
    const tasks = projectTasks(ctx.project).filter((t) => !input.phaseKey || t.phaseKey === input.phaseKey);
    const lines = tasks.map((t) =>
      [
        `- ${t.title} [id ${t.id}] in ${phases.get(t.phaseKey) ?? t.phaseKey}`,
        t.done ? "done" : "open",
        t.start && t.due ? `${t.start} to ${t.due}` : t.due ? `due ${t.due}` : "no dates",
        t.after?.length ? `after ${t.after.join(", ")}` : "",
        t.milestone ? "milestone" : "",
        t.estimateHours != null ? `${t.estimateHours} h` : "",
        critical.has(t.id) ? "critical" : "",
      ]
        .filter(Boolean)
        .join("; ")
    );
    return { content: lines.length ? `The timeline, saved data:\n${lines.join("\n")}` : "Nothing on the timeline yet." };
  },
});

registerTool({
  name: "plan_timeline",
  module: "tasks_calendar",
  label: "Planning the timeline",
  description:
    "Plans steps and tasks on the timeline as she would by dragging: give each a start and due day (moving a task pushes the tasks that wait on it), what it waits on (ids from read_timeline), whether it is a milestone, and its estimate in hours. Each change can be undone.",
  input: z.object({
    changes: z
      .array(
        z.object({
          taskId: z.string().min(1).max(100),
          start: day.nullable().optional().describe("First day of work; leave out to keep it, null for a one-day task"),
          due: day.nullable().optional().describe("Due day; null takes the dates off"),
          after: z.array(z.string().max(100)).max(20).optional().describe("Ids it waits on; [] for none"),
          milestone: z.boolean().optional(),
          estimateHours: z.number().min(0).max(10_000).nullable().optional(),
        })
      )
      .min(1)
      .max(30),
  }),
  async run(ctx, input) {
    const mutations: ProjectMutation[] = [];
    const named: string[] = [];
    try {
      for (const c of input.changes) {
        const task = taskById(ctx.project, c.taskId);
        if (!task) return { content: `There is no task '${c.taskId}'. Read the timeline for the ids.`, isError: true };
        named.push(task.title);
        if (c.start !== undefined || c.due !== undefined) {
          const due = c.due === undefined ? task.due ?? null : c.due;
          const start = c.start === undefined ? (task.start && task.start !== task.due ? task.start : null) : c.start;
          if (due && start && start > due) return { content: `${task.title}: the start is after the due day.`, isError: true };
          // Moving a dated task pushes what waits on it, as dragging does.
          if (due) mutations.push({ type: "scheduleTasks", changes: planMove(ctx.project, task.id, start ?? due, due) });
          else mutations.push({ type: "scheduleTasks", changes: [{ taskId: task.id, start: null, due: null }] });
        }
        if (c.after !== undefined || c.milestone !== undefined || c.estimateHours !== undefined) {
          const record = ctx.project.tasks.find((t) => t.stepItemId === task.id || (!t.stepItemId && t.id === task.id));
          mutations.push({
            type: "setTaskPlan",
            taskId: task.id,
            after: c.after ?? record?.after ?? [],
            milestone: c.milestone ?? !!record?.milestone,
            estimateHours: c.estimateHours === undefined ? record?.estimateHours ?? null : c.estimateHours,
          });
        }
      }
    } catch (err) {
      if (err instanceof PlanError) return { content: err.message, isError: true };
      throw err;
    }
    if (!mutations.length) return { content: "Nothing to change." };
    const summary = named.length === 1 ? `Plan ${named[0]} on the timeline` : `Plan ${named.length} tasks on the timeline`;
    return {
      content: `Prepared: ${summary.toLowerCase()}.`,
      proposals: [{ summary, mutation: mutations.length === 1 ? mutations[0] : { type: "batch", mutations } }],
    };
  },
});

registerTool({
  name: "set_baseline",
  module: "tasks_calendar",
  label: "Saving the baseline",
  description: "Saves the timeline as it stands now as the baseline, so later slips show against it (save: true), or clears the baseline (save: false). She confirms it.",
  input: z.object({ save: z.boolean() }),
  async run(_ctx, input) {
    const summary = input.save ? "Save the timeline as the baseline" : "Clear the timeline's baseline";
    return { content: `Prepared: ${summary.toLowerCase()}.`, proposals: [{ summary, mutation: { type: "setBaseline", save: input.save } }] };
  },
});

registerTool({
  name: "update_project_details",
  module: "checklist",
  label: "Updating the project's details",
  description: "Changes the project's name, client, colour or start date, as in Project settings. Can be undone.",
  input: z.object({
    name: z.string().trim().min(1).max(255).optional(),
    client: z.string().trim().min(1).max(255).optional(),
    swatch: z.enum(["clay", "sage", "oak", "slate", "blush", "ochre"]).optional(),
    startDate: day.optional(),
  }),
  async run(_ctx, input) {
    const m: ProjectMutation = {
      type: "updateDetails",
      ...(input.name ? { name: input.name } : {}),
      ...(input.client ? { client: input.client } : {}),
      ...(input.swatch ? { swatch: input.swatch } : {}),
      ...(input.startDate ? { startDate: `${input.startDate}T00:00:00.000Z` } : {}),
    };
    const parts = [input.name && `name to "${input.name}"`, input.client && `client to "${input.client}"`, input.swatch && `colour to ${input.swatch}`, input.startDate && `start to ${input.startDate}`].filter(Boolean);
    if (!parts.length) return { content: "Nothing to change." };
    const summary = `Change the project's ${parts.join(", ")}`;
    return { content: `Prepared: ${summary}.`, proposals: [{ summary, mutation: m }] };
  },
});

// The workflow editor's changes, with new phase keys and step ids made here rather than by the model.
const workflowEdit = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("addPhase"),
    name: z.string().trim().min(1).max(500),
    description: z.string().max(2000).optional(),
    after: z.string().max(100).optional().describe("The phase key it follows; leave out to put it last"),
  }),
  z.object({
    type: z.literal("addStep"),
    phaseKey: z.string().max(100),
    text: z.string().trim().min(1).max(500),
    essential: z.boolean().optional(),
    relativeDaysDue: z.number().int().min(0).max(3650).optional().describe("Days after the phase starts that it is due"),
    after: z.string().max(100).nullable().optional().describe("The step id it follows; null puts it first; leave out for last"),
  }),
  ...workflowChange.options.filter((o) => !["addPhase", "addStep"].includes(o.shape.type.value)),
]);

registerTool({
  name: "edit_workflow",
  module: "checklist",
  label: "Changing the project's workflow",
  description:
    "Changes this project's own copy of its workflow, as the workflow editor in Project settings does: add, rename, describe, move, turn off or remove phases (by key) and steps (by id), mark steps essential, and set when they fall due. Phases already done or under way are protected. She confirms these changes.",
  input: z.object({ changes: z.array(workflowEdit).min(1).max(20) }),
  async run(ctx, input) {
    const known = new Set(getWorkflow(ctx.project).phases.map((p) => p.key));
    const changes: WorkflowChange[] = [];
    const words: string[] = [];
    for (const c of input.changes) {
      if (c.type === "addPhase") {
        const key = newPhaseKey();
        known.add(key);
        changes.push({ type: "addPhase", key, name: c.name, description: c.description, after: c.after });
        words.push(`add phase "${c.name}"`);
      } else if (c.type === "addStep") {
        if (!known.has(c.phaseKey)) return { content: `There is no phase '${c.phaseKey}'.`, isError: true };
        const id = newStepId();
        changes.push({ type: "addStep", id, phaseKey: c.phaseKey, text: c.text, essential: c.essential, relativeDaysDue: c.relativeDaysDue });
        if ("after" in c && c.after !== undefined) changes.push({ type: "moveStep", itemId: id, after: c.after as string | null });
        words.push(`add step "${c.text}"`);
      } else {
        if ("phaseKey" in c && !known.has(c.phaseKey)) return { content: `There is no phase '${c.phaseKey}'.`, isError: true };
        if ("itemId" in c && !stepPhase(ctx.project, c.itemId)) return { content: `There is no step '${c.itemId}'.`, isError: true };
        changes.push(c);
        words.push(c.type.replace(/([A-Z])/g, " $1").toLowerCase());
      }
    }
    const mutations: ProjectMutation[] = changes.map((change) => ({ type: "customizeWorkflow", change }));
    const summary = `Workflow: ${words.slice(0, 4).join(", ")}${words.length > 4 ? ` and ${words.length - 4} more` : ""}`;
    return { content: `Prepared: ${summary}.`, proposals: [{ summary, mutation: mutations.length === 1 ? mutations[0] : { type: "batch", mutations } }] };
  },
});

// ------------------------------------------------ the team whiteboard

registerTool({
  name: "edit_whiteboard_notes",
  module: "team_space",
  label: "Rearranging the whiteboard",
  description:
    "Changes notes already on the project's team whiteboard (ids from read_whiteboard): rewrite, recolour, resize or move them (x and y on the board), turn one into a heading or text, or remove it. Use add_whiteboard_notes for new ones.",
  input: z.object({
    changes: z
      .array(
        z.object({
          id: z.string().uuid(),
          remove: z.boolean().optional(),
          text: z.string().trim().min(1).max(4000).optional(),
          kind: z.enum(["note", "text", "heading"]).optional(),
          color: z.enum(NOTE_COLORS).optional(),
          x: z.number().min(0).max(BOARD_WIDTH).optional(),
          y: z.number().min(0).max(BOARD_HEIGHT).optional(),
          w: z.number().min(80).max(800).optional(),
          h: z.number().min(40).max(800).optional(),
        })
      )
      .min(1)
      .max(50),
  }),
  async run(ctx, input) {
    const notes = new Map((await listNotes(ctx.db, ctx.run.workspaceId, ctx.project.id)).map((n) => [n.id, n]));
    const [me] = await ctx.db.query<{ name: string | null; email: string }>("SELECT name, email FROM users WHERE id = $1", [ctx.run.userId]);
    const by = `${me?.name || me?.email || "Teammate"} (via assistant)`;
    let moved = 0;
    let removed = 0;
    for (const c of input.changes) {
      const note = notes.get(c.id);
      if (!note) return { content: `There is no note '${c.id}' on the whiteboard. Read it for the ids.`, isError: true };
      if (c.remove) {
        await applyWhiteboardOp(ctx.db, ctx.run.workspaceId, ctx.project.id, by, { type: "remove", id: c.id });
        removed++;
        continue;
      }
      const next = { id: note.id, kind: note.kind, text: note.text, color: note.color, x: note.x, y: note.y, w: note.w, h: note.h, ...Object.fromEntries(Object.entries(c).filter(([k, v]) => k !== "remove" && v !== undefined)) };
      next.x = Math.min(next.x, BOARD_WIDTH - next.w);
      next.y = Math.min(next.y, BOARD_HEIGHT - next.h);
      await applyWhiteboardOp(ctx.db, ctx.run.workspaceId, ctx.project.id, by, { type: "put", note: whiteboardNoteSchema.parse(next) });
      moved++;
    }
    return { content: `On the whiteboard: ${moved ? `changed ${moved}` : ""}${moved && removed ? ", " : ""}${removed ? `removed ${removed}` : ""}.` };
  },
});
