import { z } from "zod";
import { MODULE_REGISTRY, parseModuleRef } from "@/lib/modules/registry";
import type { FeatureState } from "@/lib/workspaces/store";
import { EDITABLE_MODULES, publishErrors } from "./editor-model";
import type { WorkflowDefinition } from "./schema";
export const BuildInputSchema = z
  .object({
    process: z
      .string()
      .trim()
      .min(20, "Describe your process in at least 20 characters.")
      .max(12000),
    outputs: z.string().max(4000),
    people: z.string().max(4000),
    documents: z.string().max(4000),
    aiHelp: z.string().max(4000),
    procedure: z.string().max(30000),
    answers: z
      .array(
        z
          .object({
            question: z.string().max(500),
            answer: z.string().max(2000),
          })
          .strict(),
      )
      .max(12),
  })
  .strict();
export type BuildInput = z.infer<typeof BuildInputSchema>;
/** Unfinished browser drafts may have a shorter/empty process description. */
export const BuildDraftSchema = BuildInputSchema.extend({
  process: z.string().max(12000),
});
const field = z
  .object({
    key: z.string().max(60),
    label: z.string().max(200),
    hint: z.string().max(2000),
  })
  .strict();
const phase = z
  .object({
    key: z.string().max(60),
    name: z.string().max(200),
    description: z.string().max(2000),
    modules: z.array(z.string().max(120)).min(1).max(20),
    checklist: z
      .array(
        z
          .object({
            id: z.string().max(60),
            text: z.string().max(500),
            essential: z.boolean(),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
export const BuildReplySchema = z
  .object({
    workflow: z
      .object({
        name: z.string().min(1).max(200),
        description: z.string().max(2000),
        phases: z.array(phase).min(1).max(30),
        forms: z
          .array(
            z
              .object({
                key: z.string().max(60),
                name: z.string().max(200),
                fields: z.array(field).min(1).max(100),
              })
              .strict(),
          )
          .max(30),
        handoffs: z
          .array(
            z
              .object({
                from: z.string().max(120),
                to: z.string().max(120),
                description: z.string().max(2000),
              })
              .strict(),
          )
          .max(100),
      })
      .strict()
      .nullable(),
    questions: z.array(z.string().min(1).max(500)).max(6),
    missingCapabilities: z.array(z.string().min(1).max(500)).max(20),
    notes: z.string().max(4000),
  })
  .strict();
export const BUILD_REPLY_SCHEMA = z.toJSONSchema(BuildReplySchema) as Record<
  string,
  unknown
>;
export interface BuildResult {
  workflow: WorkflowDefinition | null;
  questions: string[];
  missingCapabilities: string[];
  notes: string;
  reviewed: boolean;
  reviewPassed: boolean;
  reviewFeedback?: string;
  attempts: number;
}
export interface BuildRecord {
  id: string;
  mode: "interview" | "generate";
  input: BuildInput;
  status: "running" | "ready" | "failed";
  result: BuildResult | null;
  error: string | null;
  acceptedWorkflowId: string | null;
  createdAt: string;
  costZar: number;
}
export interface BuilderSettings {
  enabled: boolean;
  audience: "admin" | "owners";
  monthlyCapZar: number;
  spentZar: number;
}
const gates: Partial<Record<string, keyof FeatureState>> = {
  floor_plan_editor: "floor_plan",
  layout_generator: "layout",
  sharing: "sharing",
  comments: "sharing",
  canvas_board: "design",
  item_register: "design",
  regulatory_checklist: "design",
  link_importer: "design",
  message_drafter: "design",
  template_export: "design",
  ai_chat: "ai",
};
export function builderModules(features?: Partial<FeatureState>) {
  return EDITABLE_MODULES.filter(
    (key) => !gates[key] || features?.[gates[key]!] !== false,
  ).map((key) => ({
    ...MODULE_REGISTRY[key],
    settingsEditable: false,
    variants:
      key === "item_register"
        ? ["palette", "schedule", "register", "outstanding"]
        : key === "canvas_board"
          ? ["moodboard", "references"]
          : key === "structured_form"
            ? ["a declared form key"]
            : [],
    aiActionsExecutableFromDefinition: false,
  }));
}
export function parseBuildReply(
  text: string,
  mode: BuildRecord["mode"],
  features?: Partial<FeatureState>,
) {
  let value: unknown;
  try {
    value = JSON.parse(
      text.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, ""),
    );
  } catch {
    return { errors: ["Return one valid JSON object."], result: null };
  }
  const parsed = BuildReplySchema.safeParse(value);
  if (!parsed.success)
    return {
      errors: parsed.error.issues.map(
        (i) => `${i.path.join(".")}: ${i.message}`,
      ),
      result: null,
    };
  const reply = parsed.data,
    errors: string[] = [];
  if (mode === "interview" && reply.workflow !== null)
    errors.push("Interview mode must return questions without a workflow.");
  if (mode === "generate" && !reply.workflow)
    errors.push("Generate mode must return a complete workflow.");
  let workflow: WorkflowDefinition | null = null;
  if (reply.workflow) {
    const { forms, ...rest } = reply.workflow;
    workflow = {
      ...rest,
      id: "builder-preview",
      version: 1,
      labels: {
        project: "Project",
        client: "Client",
        item: "Selection",
        phase: "Phase",
        ...Object.fromEntries(forms.map((f) => [f.key, f.name])),
      },
      forms: forms.map(({ key, fields }) => ({ key, fields })),
      phases: rest.phases.map((p) => ({ ...p, ai_actions: [] })),
    };
    errors.push(...publishErrors(workflow).errors);
    const available = new Set(builderModules(features).map((m) => m.key));
    for (const p of workflow.phases)
      for (const ref of p.modules) {
        const { key, variant } = parseModuleRef(ref);
        if (!available.has(key))
          errors.push(`Module ${ref} is not enabled for this account.`);
        if (
          key === "canvas_board" &&
          !["moodboard", "references"].includes(variant ?? "")
        )
          errors.push("Use supported moodboard or references boards.");
        if (
          ref.split(":").length > 2 ||
          (!["canvas_board", "item_register", "structured_form"].includes(
            key,
          ) &&
            variant)
        )
          errors.push(`Module ${ref} has an unsupported variant.`);
      }
  }
  return {
    errors,
    result: errors.length
      ? null
      : {
          workflow,
          questions: reply.questions,
          missingCapabilities: reply.missingCapabilities,
          notes: reply.notes,
        },
  };
}
export function workflowEditSummary(
  before: WorkflowDefinition,
  after: WorkflowDefinition,
) {
  const changed = (a: unknown, b: unknown) =>
    JSON.stringify(a) !== JSON.stringify(b);
  const old = new Map(before.phases.map((p) => [p.key, p])),
    next = new Map(after.phases.map((p) => [p.key, p]));
  return {
    nameChanged: before.name !== after.name,
    phasesAdded: after.phases.filter((p) => !old.has(p.key)).length,
    phasesRemoved: before.phases.filter((p) => !next.has(p.key)).length,
    phasesEdited: after.phases.filter(
      (p) => old.has(p.key) && changed(old.get(p.key), p),
    ).length,
    phaseOrderChanged: changed(
      before.phases.map((p) => p.key),
      after.phases.map((p) => p.key),
    ),
    formsChanged: changed(before.forms, after.forms),
    handoffsChanged: changed(before.handoffs, after.handoffs),
    labelsChanged: changed(before.labels, after.labels),
  };
}
