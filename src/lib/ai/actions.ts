import { z } from "zod";
import type { Db } from "@/lib/db";
import { newProjectInput, projectMutation, type ProjectMutation } from "@/lib/projects/mutations";
import { applyMutation, createProject, MutationError } from "@/lib/projects/store";
import type { Project } from "@/lib/studio/types";
import { phaseSpans } from "@/lib/studio/timeline";

/**
 * What the assistant may do to the work, as data: one of the changes a person
 * makes to a project, several of them as one step, a new project, or an edit
 * to the floor plan (recorded once it is saved).
 *
 * Small changes that can be taken back are applied straight away, each with
 * the change that undoes it, so the assistant can get on with the work. The
 * rest (deleting, completing a phase, starting a project, more than a few
 * changes at once) wait for the person to confirm.
 */

export const createProjectAction = z.object({
  type: z.literal("createProject"),
  project: newProjectInput,
});

export const planEditAction = z.object({
  type: z.literal("planEdit"),
  /** The plan's revision once the edit was saved. */
  revision: z.number().int().min(1),
  changes: z.array(z.string()).max(200),
});

export const boardEditAction = z.object({
  type: z.literal("boardEdit"),
  key: z.string().max(60),
  /** The design's revision once the edit was saved. */
  revision: z.number().int().min(1),
  changes: z.array(z.string()).max(200),
});

export const batchAction = z.object({
  type: z.literal("batch"),
  mutations: z.array(projectMutation).min(1).max(100),
});

export const assistantAction = z.union([projectMutation, batchAction, createProjectAction, planEditAction, boardEditAction]);
export type AssistantAction = z.infer<typeof assistantAction>;

/** How many changes one step may make before it needs confirming. */
export const DIRECT_LIMIT = 5;

/** Changes that can be taken back exactly, so they need no confirming. */
const REVERSIBLE = new Set<ProjectMutation["type"]>([
  "setCheck",
  "setWaitingOn",
  "setStatus",
  "updateBrief",
  "setClientVisible",
  "addTask",
  "updateTask",
  "setPhaseStart",
  "setStepDue",
  "setStepOutput",
]);

/** The change that puts the project back as it was before `m`; null when `m` cannot be taken back. */
export function inverseOf(project: Project, m: ProjectMutation): ProjectMutation | null {
  switch (m.type) {
    case "setCheck":
      return { type: "setCheck", itemId: m.itemId, done: !!project.checks[m.itemId] };
    case "setWaitingOn":
      return { type: "setWaitingOn", waitingOn: project.waitingOn };
    case "setStatus":
      return project.status === "complete" ? null : { type: "setStatus", status: project.status };
    case "updateBrief":
      return {
        type: "updateBrief",
        patch: Object.fromEntries(Object.keys(m.patch).map((k) => [k, project.brief[k] ?? ""])),
        fromAi: false,
      };
    case "setClientVisible": {
      const doc = project.documents.find((d) => d.id === m.documentId);
      return doc ? { type: "setClientVisible", documentId: doc.id, clientVisible: doc.clientVisible } : null;
    }
    case "addTask":
      return { type: "deleteTask", taskId: m.id };
    case "updateTask": {
      const task = project.tasks.find((t) => t.id === m.taskId && !t.stepItemId);
      if (!task) return null;
      return {
        type: "updateTask",
        taskId: task.id,
        ...(m.title !== undefined ? { title: task.title } : {}),
        ...(m.due !== undefined ? { due: task.due ?? null } : {}),
        ...(m.done !== undefined ? { done: task.done } : {}),
        ...(m.outputDocumentId !== undefined ? { outputDocumentId: task.outputDocumentId ?? null } : {}),
      };
    }
    case "setPhaseStart": {
      // Moving a phase carries the later ones along, so moving it back to where it started puts them all back.
      const span = phaseSpans(project).find((s) => s.key === m.phaseKey);
      return span ? { type: "setPhaseStart", phaseKey: m.phaseKey, start: span.start } : null;
    }
    case "setStepDue": {
      const record = project.tasks.find((t) => t.stepItemId === m.itemId);
      return { type: "setStepDue", itemId: m.itemId, due: record?.due ?? null };
    }
    case "setStepOutput": {
      const record = project.tasks.find((t) => t.stepItemId === m.itemId);
      return { type: "setStepOutput", itemId: m.itemId, documentId: record?.outputDocumentId ?? null };
    }
    default:
      return null;
  }
}

/** The change that undoes `action`, worked out against the project before it; null when it cannot be undone this way. */
export function undoFor(project: Project, action: AssistantAction): AssistantAction | null {
  if (action.type === "createProject" || action.type === "planEdit" || action.type === "boardEdit") return null;
  if (action.type === "batch") {
    const inverses: ProjectMutation[] = [];
    for (const m of action.mutations) {
      if (!REVERSIBLE.has(m.type)) return null;
      const inverse = inverseOf(project, m);
      if (!inverse) return null;
      inverses.push(inverse);
    }
    return { type: "batch", mutations: inverses.reverse() };
  }
  if (!REVERSIBLE.has(action.type)) return null;
  return inverseOf(project, action);
}

/** Whether the assistant may apply `action` without asking: small, and reversible. */
export function canApplyDirectly(project: Project, action: AssistantAction): boolean {
  if (action.type === "batch" && action.mutations.length > DIRECT_LIMIT) return false;
  return undoFor(project, action) != null;
}

/**
 * Applies an action as a person's edit would be applied. Returns the project
 * as saved: for a new project, the new one.
 */
export async function applyAction(db: Db, workspaceId: string, slug: string, action: AssistantAction): Promise<Project> {
  switch (action.type) {
    case "createProject":
      return createProject(db, workspaceId, action.project);
    case "planEdit":
      throw new MutationError("A plan edit is saved by the plan tools, not applied again");
    case "boardEdit":
      throw new MutationError("A board edit is saved by the board tools, not applied again");
    case "batch": {
      let project: Project | null = null;
      for (const m of action.mutations) {
        project = await applyMutation(db, workspaceId, slug, m);
        if (!project) throw new MutationError("Project not found");
      }
      return project!;
    }
    default: {
      const project = await applyMutation(db, workspaceId, slug, action);
      if (!project) throw new MutationError("Project not found");
      return project;
    }
  }
}

/** Reads a stored action back; null when it no longer fits (a change of schema). */
export function parseAction(raw: unknown): AssistantAction | null {
  const parsed = assistantAction.safeParse(typeof raw === "string" ? JSON.parse(raw) : raw);
  return parsed.success ? parsed.data : null;
}
