import interiorDesignCorporate from "./definitions/interior-design-corporate.json";
import type { WorkflowDefinition, PhaseDefinition } from "./schema";

// Definitions are data. Screens read phases, checklists, labels and handoffs
// from here instead of hard-coding any domain words.
const DEFINITIONS: Record<string, WorkflowDefinition> = {
  [interiorDesignCorporate.id]: interiorDesignCorporate as WorkflowDefinition,
};

export const DEFAULT_WORKFLOW_ID = interiorDesignCorporate.id;

export function getWorkflow(id: string): WorkflowDefinition {
  return DEFINITIONS[id] ?? DEFINITIONS[DEFAULT_WORKFLOW_ID];
}

export function listWorkflows(): WorkflowDefinition[] {
  return Object.values(DEFINITIONS);
}

export function getPhase(workflowId: string, phaseKey: string): PhaseDefinition | undefined {
  return getWorkflow(workflowId).phases.find((p) => p.key === phaseKey);
}

export function label(workflowId: string, key: string, fallback: string): string {
  return getWorkflow(workflowId).labels[key] ?? fallback;
}

/** The handoff that leaves a phase, if any, e.g. "discovery.brief" -> "space_planning.context". */
export function handoffFrom(workflowId: string, phaseKey: string) {
  return getWorkflow(workflowId).handoffs.find((h) => h.from.split(".")[0] === phaseKey);
}
