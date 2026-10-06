import { WorkflowDefinition, WorkflowDefinitionSchema } from "./schema";
import { ZodError } from "zod";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  workflow?: WorkflowDefinition;
}

/**
 * Validates a workflow JSON object against the workflow specification schema.
 */
export function validateWorkflowDefinition(input: unknown): ValidationResult {
  try {
    const parsed = WorkflowDefinitionSchema.parse(input);

    // Cross-phase handoff consistency check
    const phaseKeys = new Set(parsed.phases.map((p) => p.key));
    const handoffErrors: string[] = [];

    for (const handoff of parsed.handoffs) {
      const [fromPhase] = handoff.from.split(".");
      const [toPhase] = handoff.to.split(".");

      if (fromPhase && !phaseKeys.has(fromPhase)) {
        handoffErrors.push(`Handoff 'from' references unknown phase '${fromPhase}'`);
      }
      if (toPhase && !phaseKeys.has(toPhase)) {
        handoffErrors.push(`Handoff 'to' references unknown phase '${toPhase}'`);
      }
    }

    if (handoffErrors.length > 0) {
      return {
        valid: false,
        errors: handoffErrors,
      };
    }

    return {
      valid: true,
      errors: [],
      workflow: parsed,
    };
  } catch (err) {
    if (err instanceof ZodError) {
      const messages = err.issues.map(
        (issue) => `${issue.path.join(".") || "root"}: ${issue.message}`
      );
      return {
        valid: false,
        errors: messages,
      };
    }
    return {
      valid: false,
      errors: [(err as Error).message || "Unknown validation failure"],
    };
  }
}
