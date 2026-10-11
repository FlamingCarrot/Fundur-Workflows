import { z } from "zod";
import { getWorkflow } from "@/lib/workflow";
import type { Project } from "@/lib/studio/types";
import type { ChecklistItem } from "@/lib/workflow/schema";

export const regulationId = z.string().regex(/^reg-[a-zA-Z0-9-]{1,90}$/);
export const regulationDraftSchema = z
  .object({
    title: z.string().max(500),
    category: z.enum(["fire_egress", "accessibility", "other"]),
    notes: z.string().max(3_000),
  })
  .strict();
export const regulationSchema = regulationDraftSchema.extend({
  title: z.string().trim().min(1).max(500),
});
export type Regulation = z.infer<typeof regulationSchema>;
export type Regulations = Record<string, Regulation>;
export function starterRegulations(): Regulations {
  return {
    "reg-fire-egress": {
      title: "Confirm the applicable fire escape and egress requirements",
      category: "fire_egress",
      notes:
        "Record the applicable requirements, drawing references and professional review here.",
    },
    "reg-accessibility": {
      title: "Confirm the applicable accessibility requirements",
      category: "accessibility",
      notes:
        "Record the applicable requirements, drawing references and professional review here.",
    },
  };
}
export function regulationPhase(
  project: Pick<Project, "workflowId" | "workflowVersion">,
) {
  return getWorkflow(project).phases.find((p) =>
    p.modules.includes("regulatory_checklist"),
  );
}
export function projectRegulations(project: Project): Regulations {
  if (project.regulations) return project.regulations;
  const phase = regulationPhase(project);
  return phase && !project.completedPhases.includes(phase.key)
    ? starterRegulations()
    : {};
}
export function regulationSteps(
  project: Project,
  phaseKey: string,
): ChecklistItem[] {
  if (regulationPhase(project)?.key !== phaseKey) return [];
  return Object.entries(projectRegulations(project)).map(([id, r]) => ({
    id,
    text: r.title,
    essential: true,
  }));
}
