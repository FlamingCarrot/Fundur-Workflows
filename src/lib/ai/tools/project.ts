import { z } from "zod";
import type { ProjectMutation } from "@/lib/projects/mutations";
import { listProjects } from "@/lib/projects/store";
import { phaseProgress, phaseState } from "@/lib/studio/selectors";
import { openTasks, projectTasks, toDay } from "@/lib/studio/tasks";
import { addDays, phaseSpans } from "@/lib/studio/timeline";
import type { Project } from "@/lib/studio/types";
import { getWorkflow, listWorkflows } from "@/lib/workflow";
import { registerTool } from "./registry";

/**
 * The project as the assistant reads it, and what it may do with it: the same
 * changes she makes by ticking a step, adding or moving a task, or dragging a
 * phase on the timeline. Small changes apply at once with an Undo; deleting,
 * completing a phase, starting a project and bulk moves wait for her.
 */

/** The phases with their dates, the open steps of the current one, her tasks and the documents, in plain text. */
export function describeProject(project: Project): string {
  const workflow = getWorkflow(project);
  const spans = new Map(phaseSpans(project).map((s) => [s.key, s]));
  const lines: string[] = [
    `Project "${project.name}" for ${project.client}, on the "${workflow.name}" workflow. Status: ${project.status}; waiting on ${project.waitingOn === "me" ? "the designer" : "the client"}.`,
    `Started ${project.startDate.slice(0, 10)}.`,
    "",
    "Phases:",
  ];
  for (const phase of workflow.phases) {
    const p = phaseProgress(project, phase.key);
    const span = spans.get(phase.key);
    lines.push(
      `- ${phase.name} [key ${phase.key}]: ${phaseState(project, phase.key)}, ${p.done} of ${p.total} steps done${span ? `, runs ${span.start} to ${span.end}` : ""}`
    );
  }
  const current = workflow.phases.find((p) => p.key === project.currentPhase);
  if (current) lines.push("", `Steps in ${current.name}:`, ...stepLines(project, current.key));
  const own = project.tasks.filter((t) => !t.stepItemId);
  if (own.length) {
    lines.push("", "The designer's own tasks:");
    for (const t of own) lines.push(`- [${t.done ? "x" : " "}] ${t.title} (${t.phaseKey})${t.due ? `, due ${t.due}` : ""} [id ${t.id}]`);
  }
  lines.push("", project.documents.length ? "Documents:" : "No documents yet.");
  for (const d of project.documents.slice(0, 60)) {
    lines.push(
      `- ${d.name}${d.kind ? ` (${d.kind})` : ""} in ${d.phaseKey}${d.stored ? "" : ", name only"}${d.clientVisible ? ", shared with the client" : ""} [id ${d.id}]`
    );
  }
  return lines.join("\n");
}

function stepLines(project: Project, phaseKey: string): string[] {
  return projectTasks(project)
    .filter((t) => t.phaseKey === phaseKey && t.source === "step")
    .map((t) => `- [${t.done ? "x" : " "}] ${t.title}${t.essential ? " (essential)" : ""} [id ${t.id}]${t.due ? `, due ${t.due}` : ""}`);
}

function findPhase(project: Project, key: string | undefined) {
  const phases = getWorkflow(project).phases;
  const wanted = key?.trim().toLowerCase();
  const phase = wanted ? phases.find((p) => p.key === key || p.name.toLowerCase() === wanted) : phases.find((p) => p.key === project.currentPhase);
  return { phase, phases };
}

const noPhase = (key: string | undefined, phases: { key: string; name: string }[]) =>
  ({ content: `There is no phase '${key}'. Phases: ${phases.map((p) => `${p.name} [${p.key}]`).join(", ")}.`, isError: true });

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("YYYY-MM-DD");

registerTool({
  name: "read_project",
  module: "checklist",
  label: "Reading the project",
  description:
    "Reads the project: its phases with dates and progress, every step of the current phase with ids and due dates, the designer's own tasks, and the documents with their ids.",
  input: z.object({}),
  async run(ctx) {
    return { content: describeProject(ctx.project) };
  },
});

registerTool({
  name: "read_phase",
  module: "checklist",
  label: "Reading a phase",
  description: "Reads one phase's steps (with ids, whether done, due dates) and the designer's own tasks in it. Use for phases other than the current one.",
  input: z.object({ phaseKey: z.string().max(100).describe("The phase's key or name.") }),
  async run(ctx, input) {
    const { phase, phases } = findPhase(ctx.project, input.phaseKey);
    if (!phase) return noPhase(input.phaseKey, phases);
    const own = ctx.project.tasks.filter((t) => !t.stepItemId && t.phaseKey === phase.key);
    const span = phaseSpans(ctx.project).find((s) => s.key === phase.key);
    return {
      content: [
        `${phase.name} [key ${phase.key}]: ${phaseState(ctx.project, phase.key)}${span ? `, runs ${span.start} to ${span.end}` : ""}.`,
        phase.description ?? "",
        "Steps:",
        ...stepLines(ctx.project, phase.key),
        ...(own.length ? ["Own tasks:", ...own.map((t) => `- [${t.done ? "x" : " "}] ${t.title}${t.due ? `, due ${t.due}` : ""} [id ${t.id}]`)] : []),
      ]
        .filter(Boolean)
        .join("\n"),
    };
  },
});

registerTool({
  name: "add_task",
  module: "tasks_calendar",
  label: "Adding a task",
  description: "Adds a task of the designer's own to a phase (the current one when left out), with an optional due date. Applied at once; she can undo it.",
  input: z.object({ title: z.string().trim().min(1).max(500), phaseKey: z.string().max(100).optional(), due: day.optional() }),
  async run(ctx, input) {
    const { phase, phases } = findPhase(ctx.project, input.phaseKey);
    if (!phase) return noPhase(input.phaseKey, phases);
    const id = crypto.randomUUID();
    return {
      content: `Added "${input.title}" to ${phase.name} [id ${id}].`,
      proposals: [
        {
          summary: `Add task "${input.title}" to ${phase.name}${input.due ? `, due ${input.due}` : ""}`,
          mutation: { type: "addTask", id, phaseKey: phase.key, title: input.title, ...(input.due ? { due: input.due } : {}) },
        },
      ],
    };
  },
});

registerTool({
  name: "update_task",
  module: "tasks_calendar",
  label: "Changing a task",
  description: "Renames one of the designer's own tasks, moves or clears its due date (null clears it), or ticks it done. By id from read_project.",
  input: z.object({
    taskId: z.string().uuid(),
    title: z.string().trim().min(1).max(500).optional(),
    due: day.nullable().optional(),
    done: z.boolean().optional(),
  }),
  async run(ctx, input) {
    const task = ctx.project.tasks.find((t) => t.id === input.taskId && !t.stepItemId);
    if (!task) return { content: `There is no task of hers with id ${input.taskId}. Steps are changed with set_step_done and set_step_due.`, isError: true };
    const parts = [
      input.title && input.title !== task.title ? `rename to "${input.title}"` : "",
      input.due !== undefined ? (input.due ? `due ${input.due}` : "no date") : "",
      input.done !== undefined ? (input.done ? "done" : "not done") : "",
    ].filter(Boolean);
    if (!parts.length) return { content: "That changes nothing." };
    const { taskId, ...patch } = input;
    return {
      content: `Changed "${task.title}": ${parts.join(", ")}.`,
      proposals: [{ summary: `"${task.title}": ${parts.join(", ")}`, mutation: { type: "updateTask", taskId, ...patch } }],
    };
  },
});

registerTool({
  name: "delete_task",
  module: "tasks_calendar",
  label: "Preparing to delete a task",
  description: "Deletes one of the designer's own tasks. She confirms first.",
  input: z.object({ taskId: z.string().uuid() }),
  async run(ctx, input) {
    const task = ctx.project.tasks.find((t) => t.id === input.taskId && !t.stepItemId);
    if (!task) return { content: `There is no task of hers with id ${input.taskId}.`, isError: true };
    return {
      content: `Prepared. She confirms deleting "${task.title}".`,
      proposals: [{ summary: `Delete task "${task.title}"`, mutation: { type: "deleteTask", taskId: task.id }, confirm: true }],
    };
  },
});

const stepById = (project: Project, id: string) =>
  getWorkflow(project)
    .phases.flatMap((p) => p.checklist)
    .find((i) => i.id === id);

registerTool({
  name: "set_step_done",
  module: "checklist",
  label: "Ticking a step",
  description: "Ticks (or unticks) a workflow step by its id. Applied at once; she can undo it.",
  input: z.object({ itemId: z.string().min(1).max(100), done: z.boolean().default(true) }),
  async run(ctx, input) {
    const item = stepById(ctx.project, input.itemId);
    if (!item) return { content: `There is no step with id '${input.itemId}'.`, isError: true };
    return {
      content: `Marked "${item.text}" ${input.done ? "done" : "not done"}.`,
      proposals: [{ summary: `Mark "${item.text}" as ${input.done ? "done" : "not done"}`, mutation: { type: "setCheck", itemId: item.id, done: input.done } }],
    };
  },
});

registerTool({
  name: "set_step_due",
  module: "tasks_calendar",
  label: "Moving a step's date",
  description: "Moves a workflow step's due date (null puts it back on the workflow's own date). Applied at once; she can undo it.",
  input: z.object({ itemId: z.string().min(1).max(100), due: day.nullable() }),
  async run(ctx, input) {
    const item = stepById(ctx.project, input.itemId);
    if (!item) return { content: `There is no step with id '${input.itemId}'.`, isError: true };
    return {
      content: `"${item.text}" is now ${input.due ? `due ${input.due}` : "back on its planned date"}.`,
      proposals: [{ summary: `"${item.text}" ${input.due ? `due ${input.due}` : "back on its planned date"}`, mutation: { type: "setStepDue", itemId: item.id, due: input.due } }],
    };
  },
});

registerTool({
  name: "move_phase",
  module: "tasks_calendar",
  label: "Moving a phase",
  description:
    "Moves a phase on the timeline to start on a day; the phases after it move with it, and its steps' dates follow. Applied at once; she can undo it.",
  input: z.object({ phaseKey: z.string().max(100), start: day }),
  async run(ctx, input) {
    const { phase, phases } = findPhase(ctx.project, input.phaseKey);
    if (!phase) return noPhase(input.phaseKey, phases);
    return {
      content: `${phase.name} now starts ${input.start}; later phases moved with it.`,
      proposals: [{ summary: `Move ${phase.name} to start ${input.start}`, mutation: { type: "setPhaseStart", phaseKey: phase.key, start: input.start } }],
    };
  },
});

registerTool({
  name: "shift_schedule",
  module: "tasks_calendar",
  label: "Shifting the schedule",
  description:
    "Pushes the schedule later (or earlier, with negative days) from a phase onwards (the current one when left out): the phases move, and so do the due dates of her own open tasks in them. She confirms when it moves more than a few things.",
  input: z.object({ days: z.number().int().min(-365).max(365), fromPhaseKey: z.string().max(100).optional() }),
  async run(ctx, input) {
    if (!input.days) return { content: "Zero days changes nothing." };
    const { phase, phases } = findPhase(ctx.project, input.fromPhaseKey);
    if (!phase) return noPhase(input.fromPhaseKey, phases);
    const span = phaseSpans(ctx.project).find((s) => s.key === phase.key)!;
    const after = new Set(phases.slice(phases.findIndex((p) => p.key === phase.key)).map((p) => p.key));
    const mutations: ProjectMutation[] = [{ type: "setPhaseStart", phaseKey: phase.key, start: addDays(span.start, input.days) }];
    for (const t of ctx.project.tasks) {
      if (!t.stepItemId && !t.done && t.due && after.has(t.phaseKey)) mutations.push({ type: "updateTask", taskId: t.id, due: addDays(t.due, input.days) });
    }
    const words = `${Math.abs(input.days)} day${Math.abs(input.days) === 1 ? "" : "s"} ${input.days > 0 ? "later" : "earlier"}`;
    return {
      content: `Prepared: ${phase.name} onwards ${words}, with ${mutations.length - 1} of her own tasks.`,
      proposals: [
        {
          summary: `Move ${phase.name} and everything after it ${words}${mutations.length > 1 ? `, with ${mutations.length - 1} task${mutations.length === 2 ? "" : "s"}` : ""}`,
          mutation: mutations.length === 1 ? mutations[0] : { type: "batch", mutations },
        },
      ],
    };
  },
});

registerTool({
  name: "set_waiting_on",
  module: "phase_bar",
  label: "Changing who it waits on",
  description: "Says whether the project is waiting on the designer or on the client. Applied at once; she can undo it.",
  input: z.object({ waitingOn: z.enum(["me", "client"]).describe('"me" is the designer.') }),
  async run(ctx, input) {
    const who = input.waitingOn === "me" ? "the designer" : "the client";
    return { content: `Now waiting on ${who}.`, proposals: [{ summary: `Waiting on ${who}`, mutation: { type: "setWaitingOn", waitingOn: input.waitingOn } }] };
  },
});

registerTool({
  name: "set_project_status",
  module: "phase_bar",
  label: "Pausing or resuming the project",
  description: "Puts the project on hold, or makes it active again. Applied at once; she can undo it.",
  input: z.object({ status: z.enum(["active", "on_hold"]) }),
  async run(ctx, input) {
    if (ctx.project.status === "complete") return { content: "The project is complete; its status stays.", isError: true };
    const words = input.status === "on_hold" ? "On hold" : "Active again";
    return { content: `${words}.`, proposals: [{ summary: words, mutation: { type: "setStatus", status: input.status } }] };
  },
});

registerTool({
  name: "complete_phase",
  module: "phase_bar",
  label: "Preparing to complete a phase",
  description: "Completes the current phase and moves the project to the next. Its essential steps must be done. She confirms first.",
  input: z.object({}),
  async run(ctx) {
    const { phase } = findPhase(ctx.project, undefined);
    if (!phase) return { content: "There is no current phase.", isError: true };
    const p = phaseProgress(ctx.project, phase.key);
    if (!p.ready) {
      const open = p.items.filter((i) => i.essential && !ctx.project.checks[i.id]).map((i) => i.text);
      return { content: `${phase.name} cannot complete yet. Essential steps left: ${open.join("; ")}.`, isError: true };
    }
    return {
      content: `Prepared. She confirms completing ${phase.name}.`,
      proposals: [{ summary: `Complete ${phase.name}`, mutation: { type: "completePhase", phaseKey: phase.key }, confirm: true }],
    };
  },
});

registerTool({
  name: "share_document",
  module: "documents",
  label: "Sharing a document",
  description: "Shows a document to the client, or hides it again. Applied at once; she can undo it.",
  input: z.object({ documentId: z.string().uuid(), shared: z.boolean() }),
  async run(ctx, input) {
    const doc = ctx.project.documents.find((d) => d.id === input.documentId);
    if (!doc) return { content: `There is no document with id ${input.documentId}.`, isError: true };
    const words = input.shared ? `Share ${doc.name} with the client` : `Hide ${doc.name} from the client`;
    return { content: `${words}: done.`, proposals: [{ summary: words, mutation: { type: "setClientVisible", documentId: doc.id, clientVisible: input.shared } }] };
  },
});

registerTool({
  name: "list_projects",
  module: "phase_bar",
  label: "Looking across projects",
  description: "Lists every project in the studio: client, status, current phase, who it waits on, and what is due or overdue across them.",
  input: z.object({}),
  async run(ctx) {
    const projects = await listProjects(ctx.db, ctx.run.workspaceId);
    const today = toDay(new Date());
    const due = openTasks(projects).filter((t) => t.due);
    const lines = projects.map((p) => {
      const phase = getWorkflow(p).phases.find((x) => x.key === p.currentPhase)?.name ?? p.currentPhase;
      const mine = due.filter((t) => t.projectId === p.id);
      const late = mine.filter((t) => t.due! < today).length;
      return `- ${p.name} [id ${p.id}] for ${p.client}: ${p.status}, in ${phase}, waiting on ${p.waitingOn === "me" ? "the designer" : "the client"}; ${mine.length} dated open tasks${late ? `, ${late} overdue` : ""}`;
    });
    const soon = due
      .filter((t) => t.due! <= addDays(today, 7))
      .sort((a, b) => a.due!.localeCompare(b.due!))
      .slice(0, 25)
      .map((t) => `- ${t.due}${t.due! < today ? " (overdue)" : ""}: ${t.title}, ${projects.find((p) => p.id === t.projectId)?.name}`);
    return { content: [`${projects.length} projects:`, ...lines, "", soon.length ? "Due in the next week:" : "Nothing due in the next week.", ...soon].join("\n") };
  },
});

const SWATCHES = ["clay", "sage", "oak", "slate", "blush", "ochre"] as const;

registerTool({
  name: "create_project",
  module: "phase_bar",
  label: "Preparing a new project",
  description: `Starts a new project in the studio on a workflow (${listWorkflows()
    .map((w) => `"${w.id}": ${w.name}`)
    .join("; ")}). She confirms first; it opens as its own project.`,
  input: z.object({
    name: z.string().trim().min(1).max(255),
    client: z.string().trim().min(1).max(255),
    workflowId: z.string().max(100).optional().describe("The workflow; this project's own when left out."),
    startDate: day.optional().describe("Today when left out."),
  }),
  async run(ctx, input) {
    const workflowId = input.workflowId ?? ctx.project.workflowId;
    if (!listWorkflows().some((w) => w.id === workflowId)) return { content: `There is no workflow '${workflowId}'.`, isError: true };
    const slug = input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "project";
    const start = input.startDate ?? toDay(new Date());
    return {
      content: `Prepared. She confirms starting "${input.name}" for ${input.client}.`,
      proposals: [
        {
          summary: `Start a new project "${input.name}" for ${input.client}, from ${start}`,
          mutation: {
            type: "createProject",
            project: {
              id: slug,
              name: input.name,
              client: input.client,
              workflowId,
              startDate: `${start}T00:00:00.000Z`,
              swatch: SWATCHES[Math.floor(Math.random() * SWATCHES.length)],
            },
          },
          confirm: true,
        },
      ],
    };
  },
});
