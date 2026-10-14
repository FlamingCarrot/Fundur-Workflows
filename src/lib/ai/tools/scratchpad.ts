import { z } from "zod";
import { registerTool } from "./registry";
import type { ChatScratchpad, PlanTaskItem } from "../chat-store";

const taskItemSchema = z.object({
  id: z.string().optional().describe("Optional unique ID for the task step, e.g. 'step-1'"),
  text: z.string().min(1).max(300).describe("Clear milestone or task step description"),
  status: z
    .enum(["pending", "in_progress", "completed", "failed"])
    .default("pending")
    .describe("Current execution status of this milestone"),
  note: z.string().max(300).optional().describe("Optional short status note or outcome summary"),
});

export const updatePlanInputSchema = z.object({
  title: z
    .string()
    .min(1)
    .max(200)
    .describe("High-level plan or objective title, e.g. 'Concept Office Layout (1,200 m²)' or 'FF&E Sourcing & Budget Allocation'"),
  tasks: z.array(taskItemSchema).min(1).max(12).describe("Ordered list of high-level tasks/milestones"),
});

registerTool({
  name: "update_plan",
  module: "planner",
  label: "Updating plan scratchpad",
  description:
    "Formulates or updates the high-level plan and to-do scratchpad shown to the user in an expandable accordion at the top of the chat. Use this whenever handling complex, multi-step requests (e.g. designing layouts, drafting briefs, organizing phases, sourcing FF&E, or analyzing requirements) so the user can follow along with your planned milestones.",
  input: updatePlanInputSchema,
  async run(_ctx, input) {
    const tasks: PlanTaskItem[] = input.tasks.map((t, idx) => ({
      id: t.id || `task-${idx + 1}`,
      text: t.text,
      status: t.status,
      note: t.note,
    }));
    const scratchpad: ChatScratchpad = {
      title: input.title,
      tasks,
      updatedAt: new Date().toISOString(),
    };
    const completed = tasks.filter((t) => t.status === "completed").length;
    const inProgress = tasks.find((t) => t.status === "in_progress");
    return {
      content: `Scratchpad plan updated: "${input.title}" with ${tasks.length} milestones (${completed}/${tasks.length} completed${inProgress ? `; currently working on: "${inProgress.text}"` : ""}).`,
      scratchpad,
    };
  },
});
