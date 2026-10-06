import { WorkflowDefinition, WorkflowDefinitionSchema } from "./schema";
import { MODULE_REGISTRY, parseModuleRef } from "@/lib/modules/registry";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  workflow?: WorkflowDefinition;
}

function duplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const v of values) (seen.has(v) ? dupes : seen).add(v);
  return [...dupes];
}

/**
 * Checks a workflow definition against the schema and against the rules the
 * schema alone cannot express: unique keys, only registered modules, forms
 * that exist, and handoffs between real phases. All problems are reported
 * together so a definition can be fixed in one pass.
 */
export function validateWorkflowDefinition(input: unknown): ValidationResult {
  const result = WorkflowDefinitionSchema.safeParse(input);
  if (!result.success) {
    return {
      valid: false,
      errors: result.error.issues.map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`),
    };
  }

  const wf = result.data;
  const errors: string[] = [];
  const phaseKeys = new Set(wf.phases.map((p) => p.key));
  const formKeys = new Set(wf.forms.map((f) => f.key));

  for (const key of duplicates(wf.phases.map((p) => p.key))) {
    errors.push(`Phase key '${key}' is used more than once`);
  }
  // Checklist ids are stored per project without their phase, so they must be unique across the workflow.
  for (const id of duplicates(wf.phases.flatMap((p) => p.checklist.map((c) => c.id)))) {
    errors.push(`Checklist item id '${id}' is used more than once`);
  }
  for (const key of duplicates(wf.forms.map((f) => f.key))) {
    errors.push(`Form key '${key}' is used more than once`);
  }
  for (const form of wf.forms) {
    for (const key of duplicates(form.fields.map((f) => f.key))) {
      errors.push(`Form '${form.key}' has field '${key}' more than once`);
    }
  }

  for (const phase of wf.phases) {
    for (const ref of phase.modules) {
      const { key, variant } = parseModuleRef(ref);
      if (!MODULE_REGISTRY[key]) {
        errors.push(`Phase '${phase.key}' uses module '${key}', which is not in the module library`);
      } else if (key === "structured_form" && (!variant || !formKeys.has(variant))) {
        errors.push(`Phase '${phase.key}' uses '${ref}', but the workflow defines no form '${variant ?? ""}'`);
      }
    }
  }

  for (const handoff of wf.handoffs) {
    const [fromPhase] = handoff.from.split(".");
    const [toPhase] = handoff.to.split(".");
    if (!phaseKeys.has(fromPhase)) errors.push(`Handoff 'from' references unknown phase '${fromPhase}'`);
    if (!phaseKeys.has(toPhase)) errors.push(`Handoff 'to' references unknown phase '${toPhase}'`);
  }

  return errors.length ? { valid: false, errors } : { valid: true, errors: [], workflow: wf };
}
