import { z } from "zod";

export const ChecklistItemSchema = z.object({
  id: z.string(),
  text: z.string().min(1, "Checklist item text cannot be empty"),
  essential: z.boolean().default(false),
  relativeDaysDue: z.number().optional(),
});

export const AIActionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  tier: z.enum(["worker", "top"]).default("worker"),
  suggestedModel: z.string().optional(),
  inputTypes: z.array(z.string()).optional(),
  outputType: z.string().optional(),
});

export const PhaseDefinitionSchema = z.object({
  key: z.string().min(1, "Phase key is required"),
  name: z.string().min(1, "Phase name is required"),
  description: z.string().optional().default(""),
  modules: z.array(z.string()).min(1, "Phase must contain at least one module"),
  checklist: z.array(ChecklistItemSchema).default([]),
  ai_actions: z.array(AIActionSchema).optional().default([]),
});

export const HandoffDefinitionSchema = z.object({
  from: z.string(),
  to: z.string(),
  description: z.string().optional(),
});

export const WorkflowDefinitionSchema = z.object({
  id: z.string().min(1, "Workflow ID is required"),
  version: z.number().int().positive("Version must be a positive integer"),
  name: z.string().min(1, "Workflow name is required"),
  description: z.string().optional().default(""),
  labels: z.record(z.string(), z.string()).default({
    project: "Project",
    item: "Item",
    client: "Client",
    phase: "Phase",
  }),
  phases: z.array(PhaseDefinitionSchema).min(1, "Workflow must have at least one phase"),
  handoffs: z.array(HandoffDefinitionSchema).default([]),
});

export type ChecklistItem = z.infer<typeof ChecklistItemSchema>;
export type AIAction = z.infer<typeof AIActionSchema>;
export type PhaseDefinition = z.infer<typeof PhaseDefinitionSchema>;
export type HandoffDefinition = z.infer<typeof HandoffDefinitionSchema>;
export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;
