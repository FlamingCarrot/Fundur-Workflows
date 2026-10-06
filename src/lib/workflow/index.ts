import interiorDesignCorporate from "./definitions/interior-design-corporate.json";
import type { WorkflowDefinition, PhaseDefinition, FormDefinition } from "./schema";
import { validateWorkflowDefinition } from "./validator";

// Definitions are data. Screens read phases, checklists, forms, labels and
// handoffs from here instead of hard-coding any domain words. Every definition
// is validated when it is loaded, so a broken one fails loudly instead of
// rendering half a workflow.
function load(input: unknown): WorkflowDefinition {
  const result = validateWorkflowDefinition(input);
  if (!result.valid || !result.workflow) {
    const id = (input as { id?: string })?.id ?? "unknown";
    throw new Error(`Workflow definition '${id}' is invalid:\n- ${result.errors.join("\n- ")}`);
  }
  return result.workflow;
}

/** Every published version of every workflow, keyed by id. Running projects stay on the version they started with. */
const VERSIONS: Record<string, WorkflowDefinition[]> = {};
for (const def of [load(interiorDesignCorporate)]) {
  (VERSIONS[def.id] ??= []).push(def);
  VERSIONS[def.id].sort((a, b) => a.version - b.version);
}

export const DEFAULT_WORKFLOW_ID = interiorDesignCorporate.id;

/** A workflow id, or anything that names a workflow and the version it runs on (such as a project). */
export type WorkflowRef = string | { workflowId: string; workflowVersion?: number };

function latest(id: string): WorkflowDefinition | undefined {
  const versions = VERSIONS[id];
  return versions?.[versions.length - 1];
}

/**
 * The definition a reference names. A project pinned to a version gets exactly
 * that version, or an error if it is not loaded: running it on another version
 * would mismatch its phases and checklist ids. Publishing a new version means
 * adding a definition file, never editing the old one.
 */
export function getWorkflow(ref: WorkflowRef): WorkflowDefinition {
  const id = typeof ref === "string" ? ref : ref.workflowId;
  const version = typeof ref === "string" ? undefined : ref.workflowVersion;
  if (version != null) {
    const pinned = VERSIONS[id]?.find((v) => v.version === version);
    if (!pinned) throw new Error(`Workflow '${id}' version ${version} is not loaded`);
    return pinned;
  }
  return latest(id) ?? latest(DEFAULT_WORKFLOW_ID)!;
}

/** The newest version of each workflow, for starting new projects. */
export function listWorkflows(): WorkflowDefinition[] {
  return Object.keys(VERSIONS).map((id) => latest(id)!);
}

export function getPhase(ref: WorkflowRef, phaseKey: string): PhaseDefinition | undefined {
  return getWorkflow(ref).phases.find((p) => p.key === phaseKey);
}

export function getForm(ref: WorkflowRef, formKey: string): FormDefinition | undefined {
  return getWorkflow(ref).forms.find((f) => f.key === formKey);
}

/** The phase that shows a form, e.g. the phase with "structured_form:brief". */
export function phaseWithForm(ref: WorkflowRef, formKey: string): PhaseDefinition | undefined {
  return getWorkflow(ref).phases.find((p) => p.modules.includes(`structured_form:${formKey}`));
}

export function label(ref: WorkflowRef, key: string, fallback: string): string {
  return getWorkflow(ref).labels[key] ?? fallback;
}

/** The handoff that leaves a phase, if any, e.g. "discovery.brief" -> "space_planning.context". */
export function handoffFrom(ref: WorkflowRef, phaseKey: string) {
  return getWorkflow(ref).handoffs.find((h) => h.from.split(".")[0] === phaseKey);
}
