import {WorkflowDefinitionSchema} from "@/lib/workflow/schema";
import { z } from "zod";
import { designItemSchema, type DesignData } from "@/lib/design/schema";
import { emptyDesign, newItem } from "@/lib/design/model";
import {
  regulationSchema,
  projectRegulations,
  starterRegulations,
} from "@/lib/regulations/model";
import { getWorkflow } from "@/lib/workflow";
import type { Project } from "@/lib/studio/types";
export const setupSchema = z
  .object({
    workflowId: z.string().min(1).max(100),
    workflowVersion: z.number().int().positive(),
    workflowDefinition: WorkflowDefinitionSchema.optional(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    items: z
      .array(
        designItemSchema.pick({
          name: true,
          category: true,
          tags: true,
          specification: true,
          dimensions: true,
          quantity: true,
        }),
      )
      .max(200),
    requirements: z
      .array(regulationSchema.pick({ title: true, category: true }))
      .max(100),
  })
  .strict();
export const templateInput = z
  .object({ name: z.string().trim().min(1).max(200), data: setupSchema })
  .strict();
export type ProjectSetup = z.infer<typeof setupSchema>;
export type ProjectTemplate = z.infer<typeof templateInput> & {
  id: string;
  createdAt: string;
};
export type TemplateSummary = {
  id: string;
  name: string;
  createdAt: string;
  workflowId: string;
  workflowVersion: number;
  itemCount: number;
  requirementCount: number;
};
export const templateSummary = (t: ProjectTemplate): TemplateSummary => ({
  id: t.id,
  name: t.name,
  createdAt: t.createdAt,
  workflowId: t.data.workflowId,
  workflowVersion: t.data.workflowVersion,
  itemCount: t.data.items.length,
  requirementCount: t.data.requirements.length,
});
export function captureSetup(
  project: Project,
  design: DesignData,
  itemIds: string[],
): ProjectSetup {
  if (
    new Set(itemIds).size !== itemIds.length ||
    itemIds.some((id) => !design.items.some((i) => i.id === id))
  )
    throw new Error("Choose saved selections from this project.");
  return setupSchema.parse({
    workflowId: project.workflowId,
    workflowVersion: project.workflowVersion ?? getWorkflow(project).version,
    ...(project.workflowDefinition?{workflowDefinition:project.workflowDefinition}:{}),
    currency: design.currency,
    items: itemIds.map((id) => {
      const { name, category, tags, specification, dimensions, quantity } =
        design.items.find((i) => i.id === id)!;
      return { name, category, tags, specification, dimensions, quantity };
    }),
    requirements: Object.values(projectRegulations(project)).map(
      ({ title, category }) => ({ title, category }),
    ),
  });
}
export function seedSetup(raw: ProjectSetup) {
  const setup = setupSchema.parse(raw),
    workflow = getWorkflow({
      workflowId: setup.workflowId,
      workflowVersion: setup.workflowVersion,
      workflowDefinition:setup.workflowDefinition,
    });
  if (workflow.id !== setup.workflowId)
    throw new Error("That workflow is unavailable.");
  const regulatory = workflow.phases.some((p) =>
    p.modules.includes("regulatory_checklist"),
  );
  if (!regulatory && setup.requirements.length)
    throw new Error("This workflow has no regulation checklist.");
  return {
    design: {
      ...emptyDesign(),
      currency: setup.currency,
      items: setup.items.map((i) => ({
        ...newItem(crypto.randomUUID()),
        ...i,
      })),
    },
    regulations: regulatory
      ? setup.requirements.length
        ? Object.fromEntries(
            setup.requirements.map((r) => [
              `reg-${crypto.randomUUID()}`,
              { ...r, notes: "" },
            ]),
          )
        : starterRegulations()
      : {},
  };
}
