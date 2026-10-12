import { z } from "zod";
import { getWorkflow } from "@/lib/workflow";
import type { Permission } from "@/lib/auth/permissions";
import type { ProjectMutation } from "@/lib/projects/mutations";
import type { Project } from "@/lib/studio/types";

/**
 * What one teammate may see and do on one project. Everything is open by
 * default; the owner narrows it from there: read only, phases, steps and tools
 * (a project section such as "plan" or "boards/moodboard") they don't get.
 */
export const projectAccessSchema = z
  .object({
    level: z.enum(["edit", "view"]),
    hiddenPhases: z.array(z.string().min(1).max(100)).max(100),
    hiddenSteps: z.array(z.string().min(1).max(100)).max(1000),
    hiddenTools: z.array(z.string().min(1).max(200)).max(100),
    /** The quick template it was last set from, for the editor to show. */
    template: z.string().max(40).optional(),
  })
  .strict();
export type ProjectAccess = z.infer<typeof projectAccessSchema>;

export const FULL_ACCESS: ProjectAccess = {
  level: "edit",
  hiddenPhases: [],
  hiddenSteps: [],
  hiddenTools: [],
};

export function isFullAccess(access: ProjectAccess): boolean {
  return (
    access.level === "edit" &&
    !access.hiddenPhases.length &&
    !access.hiddenSteps.length &&
    !access.hiddenTools.length
  );
}

/** Tools that hold money or practice records, which "No costs" hides. */
const COST_TOOLS = ["ai", "export", "templates"];

export interface AccessTemplate {
  key: string;
  label: string;
  description: string;
  build(project: Project): ProjectAccess;
}

/** Quick starting points; the owner can change anything after picking one. */
export const ACCESS_TEMPLATES: AccessTemplate[] = [
  {
    key: "full",
    label: "Full access",
    description: "Sees and works on everything in this project.",
    build: () => ({ ...FULL_ACCESS, template: "full" }),
  },
  {
    key: "view",
    label: "View only",
    description: "Sees everything, changes nothing. Can still comment and chat.",
    build: () => ({ ...FULL_ACCESS, level: "view", template: "view" }),
  },
  {
    key: "current_phase",
    label: "Current phase only",
    description: "Works on the phase the project is in now; other phases are hidden.",
    build: (project) => ({
      ...FULL_ACCESS,
      hiddenPhases: getWorkflow(project)
        .phases.map((p) => p.key)
        .filter((k) => k !== project.currentPhase),
      template: "current_phase",
    }),
  },
  {
    key: "no_costs",
    label: "No costs",
    description: "Works on everything except AI spend, exports and saved setups.",
    build: () => ({
      ...FULL_ACCESS,
      hiddenTools: [...COST_TOOLS],
      template: "no_costs",
    }),
  },
];

/**
 * The tool key of a project section link: the path after /projects/<id>/.
 * The overview and the phases are never tools; phases are set one by one.
 */
export function toolKey(href: string, projectId: string): string | null {
  const base = `/projects/${projectId}`;
  if (href === base || !href.startsWith(base + "/")) return null;
  const rest = href.slice(base.length + 1);
  return rest.startsWith("phases/") ? null : rest;
}

export function canUseTool(access: ProjectAccess | undefined, key: string): boolean {
  if (!access) return true;
  return !access.hiddenTools.some((t) => key === t || key.startsWith(t + "/"));
}

export function canSeePhase(access: ProjectAccess | undefined, phaseKey: string): boolean {
  return !access || !access.hiddenPhases.includes(phaseKey);
}

export function canSeeStep(
  access: ProjectAccess | undefined,
  phaseKey: string,
  stepId: string,
): boolean {
  return canSeePhase(access, phaseKey) && !access?.hiddenSteps.includes(stepId);
}

/** Sections the person may open, from the full project menu. */
export function allowedSections<T extends { href: string }>(
  sections: T[],
  access: ProjectAccess | undefined,
  projectId: string,
): T[] {
  if (!access) return sections;
  return sections.filter((s) => {
    const key = toolKey(s.href, projectId);
    return key === null || canUseTool(access, key);
  });
}

/** Permissions that change the project; a view-only teammate has none of them. */
const WRITE_PERMISSIONS: Permission[] = [
  "project:edit",
  "project:archive",
  "phase:work",
  "document:upload",
  "document:share",
  "ai:use",
  "workflow:edit",
  "workflow:publish",
];
export function isWritePermission(permission: Permission): boolean {
  return WRITE_PERMISSIONS.includes(permission);
}

/** The phase a step belongs to, from the project's own workflow. */
export function phaseOfStep(project: Project, stepId: string): string | null {
  for (const phase of getWorkflow(project).phases)
    if (phase.checklist.some((i) => i.id === stepId)) return phase.key;
  return project.tasks.find((t) => t.id === stepId || t.stepItemId === stepId)?.phaseKey ?? null;
}

/**
 * Why this teammate may not make this change, or null when they may. Changes
 * that name a phase or a step are refused when it is hidden from them.
 */
export function refuseMutation(
  project: Project,
  access: ProjectAccess | undefined,
  mutation: ProjectMutation,
): string | null {
  if (!access || isFullAccess(access)) return null;
  if (access.level === "view") return "You can view this project but not change it";
  const hidden = "That part of the project is not shared with you";
  const phaseKeys: string[] = [];
  const stepIds: string[] = [];
  switch (mutation.type) {
    case "completePhase":
    case "setPhaseStart":
    case "addTask":
      phaseKeys.push(mutation.phaseKey);
      break;
    case "addDocuments":
      phaseKeys.push(...mutation.documents.map((d) => d.phaseKey));
      break;
    case "setCheck":
    case "setStepDue":
    case "setStepOutput":
      stepIds.push(mutation.itemId);
      break;
    case "updateTask":
    case "deleteTask":
    case "setTaskPlan":
      stepIds.push(mutation.taskId);
      break;
    case "scheduleTasks":
      stepIds.push(...mutation.changes.map((c) => c.taskId));
      break;
    case "shiftProject":
    case "setBaseline":
      // Moves every phase, including ones they can't see.
      if (access.hiddenPhases.length || access.hiddenSteps.length) return hidden;
      break;
  }
  if (phaseKeys.some((k) => !canSeePhase(access, k))) return hidden;
  for (const id of stepIds) {
    const phase = phaseOfStep(project, id);
    if (access.hiddenSteps.includes(id) || (phase && !canSeePhase(access, phase))) return hidden;
  }
  return null;
}

/** Hidden phases and steps that no longer exist are dropped, so the record stays tidy. */
export function tidyAccess(project: Project, access: ProjectAccess): ProjectAccess {
  const phases = getWorkflow(project).phases;
  const phaseKeys = new Set(phases.map((p) => p.key));
  const stepIds = new Set(phases.flatMap((p) => p.checklist.map((i) => i.id)));
  return {
    ...access,
    hiddenPhases: [...new Set(access.hiddenPhases.filter((k) => phaseKeys.has(k)))],
    hiddenSteps: [...new Set(access.hiddenSteps.filter((k) => stepIds.has(k)))],
    hiddenTools: [...new Set(access.hiddenTools)],
  };
}
