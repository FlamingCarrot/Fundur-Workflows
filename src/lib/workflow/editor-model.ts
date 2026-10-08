import { MODULE_REGISTRY, parseModuleRef } from "@/lib/modules/registry";
import { validateWorkflowDefinition } from "./validator";
import {WorkflowDefinitionSchema,type WorkflowDefinition} from "./schema";
export const EDITABLE_MODULES = [
  "notes",
  "checklist",
  "documents",
  "structured_form",
  "canvas_board",
  "item_register",
  "floor_plan_editor",
  "layout_generator",
  "regulatory_checklist",
  "link_importer",
  "message_drafter",
  "sharing",
  "comments",
  "tasks_calendar",
  "template_export",
  "ai_chat",
] as const;
export interface WorkflowDraft {
  id: string;
  definition: WorkflowDefinition;
  revision: number;
  publishedVersion: number;
  updatedAt: string;
  errors: string[];
}
export interface WorkflowLibrary {
  drafts: WorkflowDraft[];
  versions: WorkflowDefinition[];
}
export function publishErrors(raw: unknown) {
  const result = validateWorkflowDefinition(raw);
  const errors = [...result.errors];
  const parsed = WorkflowDefinitionSchema.safeParse(raw);
  const wf = result.workflow ?? (parsed.success ? parsed.data : undefined);
  if (wf) {
    if (JSON.stringify(wf).length > 100_000)
      errors.push("Keep the workflow definition under 100 KB.");
    if (
      wf.phases.length > 30 ||
      wf.forms.length > 30 ||
      wf.handoffs.length > 100
    )
      errors.push("Use at most 30 phases, 30 forms and 100 handoffs.");
    const validKey = {
      test: (v: string) =>
        /^[A-Za-z][A-Za-z0-9_-]{0,59}$/.test(v) &&
        !["constructor", "prototype", "__proto__"].includes(v),
    };
    if (wf.name.length > 200 || wf.description.length > 2000)
      errors.push("Shorten the workflow name or description.");
    for (const ph of wf.phases) {
      if (ph.name.length > 200 || ph.description.length > 2000)
        errors.push(`Shorten phase ${ph.key} name or description.`);
      if (new Set(ph.modules).size !== ph.modules.length)
        errors.push(`Phase ${ph.key} has duplicate modules.`);
      for (const c of ph.checklist) {
        if (
          !validKey.test(c.id) ||
          c.text.length > 500 ||
          (c.relativeDaysDue != null &&
            (!Number.isInteger(c.relativeDaysDue) ||
              c.relativeDaysDue < -365 ||
              c.relativeDaysDue > 3650))
        )
          errors.push(
            `Step ${c.id} needs a valid key, shorter text and a due day between -365 and 3650.`,
          );
      }
      if (!validKey.test(ph.key))
        errors.push(`Phase '${ph.key}' needs a simple key without spaces.`);
      if (ph.checklist.length > 100)
        errors.push(`Phase '${ph.name}' has more than 100 steps.`);
      for (const m of ph.modules) {
        const { key, variant } = parseModuleRef(m);
        if (
          !EDITABLE_MODULES.includes(
            key as (typeof EDITABLE_MODULES)[number],
          ) ||
          MODULE_REGISTRY[key]?.status !== "available"
        )
          errors.push(`Module '${m}' is unavailable in the editor.`);
        if (
          ["canvas_board", "item_register"].includes(key) &&
          (!variant || !validKey.test(variant))
        )
          errors.push(`Module '${m}' needs a valid board/register key.`);
        if (
          key === "item_register" &&
          !["palette", "schedule", "register", "outstanding"].includes(
            variant ?? "",
          )
        )
          errors.push(
            `Choose a supported palette, schedule, register or outstanding view.`,
          );
      }
    }
    for (const form of wf.forms) {
      if (!validKey.test(form.key) || form.fields.length > 100)
        errors.push(
          `Form '${form.key}' needs a valid key and at most 100 fields.`,
        );
      for (const f of form.fields) {
        if (
          !validKey.test(f.key) ||
          f.label.length > 200 ||
          (f.hint?.length && f.hint.length > 2000)
        )
          errors.push(
            `Field '${f.key}' needs a simple key and shorter labels/hints.`,
          );
      }
    }
  }
  return { errors, workflow: wf };
}
export function moveEntry<T>(entries: T[], index: number, delta: number) {
  const next = [...entries],
    target = index + delta;
  if (target < 0 || target >= next.length) return entries;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
