import { z } from "zod";
import { phaseProgress, phaseState } from "@/lib/studio/selectors";
import type { Project } from "@/lib/studio/types";
import { getWorkflow } from "@/lib/workflow";
import { registerTool } from "./registry";

/**
 * The project as the assistant reads it, and the edits it may propose to its
 * steps and tasks: the same changes she makes by ticking a step or adding a
 * task, applied only once she confirms.
 */

/** The phases, the open steps of the current one, her tasks and the documents, in plain text. */
export function describeProject(project: Project): string {
  const workflow = getWorkflow(project);
  const lines: string[] = [
    `Project "${project.name}" for ${project.client}, on the "${workflow.name}" workflow. Status: ${project.status}; waiting on ${project.waitingOn === "me" ? "the designer" : "the client"}.`,
    `Started ${project.startDate.slice(0, 10)}.`,
    "",
    "Phases:",
  ];
  for (const phase of workflow.phases) {
    const p = phaseProgress(project, phase.key);
    lines.push(`- ${phase.name} [key ${phase.key}]: ${phaseState(project, phase.key)}, ${p.done} of ${p.total} steps done`);
  }
  const current = workflow.phases.find((p) => p.key === project.currentPhase);
  if (current) {
    lines.push("", `Steps in ${current.name}:`);
    for (const item of current.checklist) {
      const task = project.tasks.find((t) => t.stepItemId === item.id);
      lines.push(
        `- [${project.checks[item.id] ? "x" : " "}] ${item.text}${item.essential ? " (essential)" : ""} [id ${item.id}]${task?.due ? `, due ${task.due}` : ""}`
      );
    }
  }
  const own = project.tasks.filter((t) => !t.stepItemId);
  if (own.length) {
    lines.push("", "The designer's own tasks:");
    for (const t of own) lines.push(`- [${t.done ? "x" : " "}] ${t.title} (${t.phaseKey})${t.due ? `, due ${t.due}` : ""} [id ${t.id}]`);
  }
  lines.push("", project.documents.length ? "Documents:" : "No documents yet.");
  for (const d of project.documents.slice(0, 60)) {
    lines.push(`- ${d.name}${d.kind ? ` (${d.kind})` : ""} in ${d.phaseKey}${d.stored ? "" : ", name only"} [id ${d.id}]`);
  }
  return lines.join("\n");
}

registerTool({
  name: "read_project",
  module: "checklist",
  label: "Reading the project",
  description:
    "Reads the project: its phases and progress, every step of the current phase with ids and due dates, the designer's own tasks, and the documents with their ids.",
  input: z.object({}),
  async run(ctx) {
    return { content: describeProject(ctx.project) };
  },
});

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

registerTool({
  name: "propose_task",
  module: "tasks_calendar",
  label: "Preparing a task",
  description:
    "Proposes adding a task of the designer's own to a phase, with an optional due date. The designer confirms before it is added. Use the phase key from read_project; leave it out for the current phase.",
  input: z.object({
    title: z.string().trim().min(1).max(500),
    phaseKey: z.string().max(100).optional(),
    due: day.optional().describe("YYYY-MM-DD"),
  }),
  async run(ctx, input) {
    const phases = getWorkflow(ctx.project).phases;
    const phase = phases.find((p) => p.key === (input.phaseKey ?? ctx.project.currentPhase));
    if (!phase) return { content: `There is no phase '${input.phaseKey}'. Phases: ${phases.map((p) => p.key).join(", ")}.` };
    return {
      content: `Proposed. The designer will see "${input.title}" in ${phase.name} and confirm it.`,
      proposals: [
        {
          summary: `Add task "${input.title}" to ${phase.name}${input.due ? `, due ${input.due}` : ""}`,
          mutation: { type: "addTask", id: crypto.randomUUID(), phaseKey: phase.key, title: input.title, ...(input.due ? { due: input.due } : {}) },
        },
      ],
    };
  },
});

registerTool({
  name: "propose_step_done",
  module: "checklist",
  label: "Preparing a step change",
  description: "Proposes ticking (or unticking) a step of the workflow's checklist, by its id from read_project. The designer confirms first.",
  input: z.object({ itemId: z.string().min(1).max(100), done: z.boolean().default(true) }),
  async run(ctx, input) {
    const item = getWorkflow(ctx.project)
      .phases.flatMap((p) => p.checklist)
      .find((i) => i.id === input.itemId);
    if (!item) return { content: `There is no step with id '${input.itemId}'.` };
    return {
      content: `Proposed. The designer will confirm marking "${item.text}" as ${input.done ? "done" : "not done"}.`,
      proposals: [
        {
          summary: `Mark "${item.text}" as ${input.done ? "done" : "not done"}`,
          mutation: { type: "setCheck", itemId: item.id, done: input.done },
        },
      ],
    };
  },
});
