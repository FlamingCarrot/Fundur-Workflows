import { getWorkflow } from "@/lib/workflow";
import { emptyBrief } from "./seed";
import { phaseProgress } from "./selectors";
import type { Project, SwatchKey } from "./types";

/**
 * Completes a phase and opens the next one. Only the open phase can be
 * completed, and only once its essentials are ticked; otherwise the project
 * comes back unchanged. The browser and the server both apply this, so a stale
 * tab cannot complete a phase the server would refuse.
 */
export function completePhase(p: Project, phaseKey: string): Project {
  if (p.currentPhase !== phaseKey || p.status === "complete" || !phaseProgress(p, phaseKey).ready) return p;
  const phases = getWorkflow(p).phases;
  const idx = phases.findIndex((ph) => ph.key === phaseKey);
  const next = phases[idx + 1];
  return {
    ...p,
    completedPhases: Array.from(new Set([...p.completedPhases, phaseKey])),
    currentPhase: next ? next.key : p.currentPhase,
    status: next ? p.status : "complete",
  };
}

/** Brief edits: AI drafts mark their fields, and a person's edit clears the mark. */
export function briefAiFieldsAfter(current: string[], fields: string[], fromAi: boolean): string[] {
  return fromAi ? Array.from(new Set([...current, ...fields])) : current.filter((f) => !fields.includes(f));
}

export interface NewProjectFields {
  id: string;
  name: string;
  client: string;
  workflowId: string;
  startDate: string;
  swatch: SwatchKey;
}

/** A fresh project on the newest version of its workflow, with its first phase open. */
export function newProject(input: NewProjectFields, now = new Date().toISOString()): Project {
  const workflow = getWorkflow(input.workflowId);
  const ref = { workflowId: workflow.id, workflowVersion: workflow.version };
  const brief = emptyBrief(ref);
  if ("clientName" in brief) brief.clientName = input.client;
  return {
    id: input.id,
    name: input.name,
    client: input.client,
    swatch: input.swatch,
    ...ref,
    status: "active",
    waitingOn: "me",
    startDate: input.startDate,
    currentPhase: workflow.phases[0].key,
    completedPhases: [],
    checks: {},
    brief,
    briefAiFields: [],
    documents: [],
    tasks: [],
    aiSpendZar: 0,
    lastActivity: now,
  };
}
