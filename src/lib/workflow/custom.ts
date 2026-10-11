import { z } from "zod";
import type { ChecklistItem, PhaseDefinition, WorkflowDefinition } from "./schema";
import { validateWorkflowDefinition } from "./validator";

/**
 * A project's own changes to its workflow (project settings).
 *
 * The published definition a project is pinned to never changes. What the
 * project changes is kept beside it as an overlay, and the workflow the app
 * runs on is the definition with the overlay laid over it:
 *
 * - Default phases and steps can be switched off and renamed, never removed,
 *   because they belong to the definition. Switching one back on restores it.
 * - Phases and steps the project adds are its own, and can be edited or removed.
 * - Any phase or step can carry modules from the module library. A phase with
 *   the "checklist" module shows its steps; without it, it is tool cards only.
 * - Phases and steps can be put in another order.
 *
 * Every change is one WorkflowChange, applied by applyWorkflowChange, both in
 * the browser and on the server (and by the AI assistant's tools), so they
 * cannot disagree about what a change does.
 */

const key = z.string().min(1).max(100);
const text = z.string().trim().min(1).max(500);
const moduleRefs = z.array(z.string().min(1).max(120)).max(30);
const days = z.number().int().min(0).max(3650);

const PhaseOverrideSchema = z.object({
  enabled: z.boolean().optional(),
  name: text.optional(),
  description: z.string().max(2000).optional(),
  modules: moduleRefs.optional(),
});

const StepOverrideSchema = z.object({
  enabled: z.boolean().optional(),
  text: text.optional(),
  essential: z.boolean().optional(),
  /** null takes the date off; absent keeps the definition's. */
  relativeDaysDue: days.nullable().optional(),
  modules: moduleRefs.optional(),
});

const CustomPhaseSchema = z.object({
  key,
  name: text,
  description: z.string().max(2000).default(""),
  modules: moduleRefs.min(1),
});

const CustomStepSchema = z.object({
  id: key,
  phaseKey: key,
  text,
  essential: z.boolean().default(false),
  relativeDaysDue: days.optional(),
  modules: moduleRefs.optional(),
});

export const WorkflowCustomizationSchema = z.object({
  /** Changes to the definition's own phases (and to added ones), by phase key. */
  phases: z.record(key, PhaseOverrideSchema).default({}),
  /** Phases the project added. */
  customPhases: z.array(CustomPhaseSchema).default([]),
  /** Every phase key in the order they run; phases missing from it keep their natural place at the end. */
  phaseOrder: z.array(key).optional(),
  /** Changes to the definition's own steps, by step id. */
  steps: z.record(key, StepOverrideSchema).default({}),
  /** Steps the project added. */
  customSteps: z.array(CustomStepSchema).default([]),
  /** Step ids in the order they show, per phase. */
  stepOrder: z.record(key, z.array(key)).default({}),
});

export type WorkflowCustomization = z.infer<typeof WorkflowCustomizationSchema>;
export type CustomPhase = z.infer<typeof CustomPhaseSchema>;
export type CustomStep = z.infer<typeof CustomStepSchema>;

export const EMPTY_CUSTOMIZATION: WorkflowCustomization = {
  phases: {},
  customPhases: [],
  steps: {},
  customSteps: [],
  stepOrder: {},
};

/** Reads a stored overlay; anything unreadable counts as no changes. */
export function parseCustomization(value: unknown): WorkflowCustomization {
  if (value == null) return EMPTY_CUSTOMIZATION;
  const parsed = WorkflowCustomizationSchema.safeParse(value);
  return parsed.success ? parsed.data : EMPTY_CUSTOMIZATION;
}

export function isCustomized(custom: WorkflowCustomization | undefined): boolean {
  if (!custom) return false;
  return (
    Object.keys(custom.phases).length > 0 ||
    custom.customPhases.length > 0 ||
    !!custom.phaseOrder?.length ||
    Object.keys(custom.steps).length > 0 ||
    custom.customSteps.length > 0 ||
    Object.keys(custom.stepOrder).length > 0
  );
}

// ---------------------------------------------------------------------------
// The outline: every phase and step, switched on or off, with where it came from.
// ---------------------------------------------------------------------------

export interface OutlineStep {
  item: ChecklistItem;
  /** True for the definition's own steps, which can be switched off but not removed. */
  fromDefinition: boolean;
  enabled: boolean;
}

export interface OutlinePhase {
  phase: PhaseDefinition;
  fromDefinition: boolean;
  enabled: boolean;
  steps: OutlineStep[];
}

function ordered<T>(items: T[], idOf: (t: T) => string, order: string[] | undefined): T[] {
  if (!order?.length) return items;
  const rank = new Map(order.map((id, i) => [id, i]));
  const natural = new Map(items.map((t, i) => [idOf(t), i]));
  return [...items].sort((a, b) => {
    const ra = rank.get(idOf(a));
    const rb = rank.get(idOf(b));
    if (ra != null && rb != null) return ra - rb;
    if (ra != null) return -1;
    if (rb != null) return 1;
    return natural.get(idOf(a))! - natural.get(idOf(b))!;
  });
}

/** Every phase and step, including the ones switched off, in the order the project runs them. */
export function workflowOutline(base: WorkflowDefinition, custom: WorkflowCustomization = EMPTY_CUSTOMIZATION): OutlinePhase[] {
  const basePhases = base.phases.map((phase) => ({ phase, fromDefinition: true }));
  const added = custom.customPhases.map((cp) => ({
    phase: { key: cp.key, name: cp.name, description: cp.description, modules: cp.modules, checklist: [], ai_actions: [] } as PhaseDefinition,
    fromDefinition: false,
  }));
  const phases = ordered([...basePhases, ...added], (p) => p.phase.key, custom.phaseOrder);

  return phases.map(({ phase, fromDefinition }) => {
    const o = custom.phases[phase.key] ?? {};
    const own: OutlineStep[] = phase.checklist.map((item) => {
      const so = custom.steps[item.id] ?? {};
      const relativeDaysDue = so.relativeDaysDue === null ? undefined : so.relativeDaysDue ?? item.relativeDaysDue;
      return {
        item: {
          ...item,
          text: so.text ?? item.text,
          essential: so.essential ?? item.essential,
          relativeDaysDue,
          ...(so.modules ?? item.modules ? { modules: so.modules ?? item.modules } : {}),
        },
        fromDefinition: true,
        enabled: so.enabled !== false,
      };
    });
    const extra: OutlineStep[] = custom.customSteps
      .filter((s) => s.phaseKey === phase.key)
      .map((s) => ({
        item: {
          id: s.id,
          text: s.text,
          essential: s.essential,
          ...(s.relativeDaysDue != null ? { relativeDaysDue: s.relativeDaysDue } : {}),
          ...(s.modules?.length ? { modules: s.modules } : {}),
        },
        fromDefinition: false,
        enabled: true,
      }));
    return {
      phase: {
        ...phase,
        name: o.name ?? phase.name,
        description: o.description ?? phase.description,
        modules: o.modules ?? phase.modules,
      },
      fromDefinition,
      enabled: o.enabled !== false,
      steps: ordered([...own, ...extra], (s) => s.item.id, custom.stepOrder[phase.key]),
    };
  });
}

const resolvedCache = new WeakMap<WorkflowCustomization, Map<WorkflowDefinition, WorkflowDefinition>>();

/** The workflow the project runs on: the definition with its changes laid over it, switched-off parts left out. */
export function applyCustomization(base: WorkflowDefinition, custom: WorkflowCustomization | undefined): WorkflowDefinition {
  if (!custom || !isCustomized(custom)) return base;
  const cached = resolvedCache.get(custom)?.get(base);
  if (cached) return cached;
  const phases = workflowOutline(base, custom)
    .filter((p) => p.enabled)
    .map((p) => ({ ...p.phase, checklist: p.steps.filter((s) => s.enabled).map((s) => s.item) }));
  // A workflow always has a phase; the guards below never let the last one go, but a stored overlay is not trusted.
  const safePhases = phases.length ? phases : base.phases;
  const keys = new Set(safePhases.map((p) => p.key));
  const resolved: WorkflowDefinition = {
    ...base,
    phases: safePhases,
    handoffs: base.handoffs.filter((h) => keys.has(h.from.split(".")[0]) && keys.has(h.to.split(".")[0])),
  };
  if (!resolvedCache.has(custom)) resolvedCache.set(custom, new Map());
  resolvedCache.get(custom)!.set(base, resolved);
  return resolved;
}

// ---------------------------------------------------------------------------
// Changes
// ---------------------------------------------------------------------------

export const workflowChange = z.discriminatedUnion("type", [
  z.object({ type: z.literal("setPhaseEnabled"), phaseKey: key, enabled: z.boolean() }),
  z.object({
    type: z.literal("addPhase"),
    /** A new key, e.g. from newPhaseKey(). */
    key,
    name: text,
    description: z.string().max(2000).optional(),
    /** Defaults to the steps module, so the new phase has a checklist. */
    modules: moduleRefs.min(1).optional(),
    /** The phase it follows; absent puts it last. */
    after: key.optional(),
  }),
  z.object({
    type: z.literal("updatePhase"),
    phaseKey: key,
    name: text.optional(),
    description: z.string().max(2000).optional(),
    modules: moduleRefs.min(1).optional(),
  }),
  z.object({ type: z.literal("removePhase"), phaseKey: key }),
  /** Moves a phase to follow another; null puts it first. */
  z.object({ type: z.literal("movePhase"), phaseKey: key, after: key.nullable() }),
  z.object({ type: z.literal("setStepEnabled"), itemId: key, enabled: z.boolean() }),
  z.object({
    type: z.literal("addStep"),
    /** A new id, e.g. from newStepId(). */
    id: key,
    phaseKey: key,
    text,
    essential: z.boolean().optional(),
    relativeDaysDue: days.optional(),
    modules: moduleRefs.optional(),
  }),
  z.object({
    type: z.literal("updateStep"),
    itemId: key,
    text: text.optional(),
    essential: z.boolean().optional(),
    /** null takes the date off the step. */
    relativeDaysDue: days.nullable().optional(),
    modules: moduleRefs.optional(),
  }),
  z.object({ type: z.literal("removeStep"), itemId: key }),
  /** Moves a step within its phase to follow another; null puts it first. */
  z.object({ type: z.literal("moveStep"), itemId: key, after: key.nullable() }),
]);

export type WorkflowChange = z.infer<typeof workflowChange>;

export class WorkflowChangeError extends Error {}

/** What the guards need to know about where the project is. */
export interface ProjectProgress {
  currentPhase: string;
  completedPhases: string[];
  status?: string;
}

const randomId = () => Math.random().toString(36).slice(2, 10);
export const newPhaseKey = () => `phase-${randomId()}`;
export const newStepId = () => `step-${randomId()}`;

function phaseOrderOf(base: WorkflowDefinition, custom: WorkflowCustomization): string[] {
  return workflowOutline(base, custom).map((p) => p.phase.key);
}

function stepOrderOf(base: WorkflowDefinition, custom: WorkflowCustomization, phaseKey: string): string[] {
  return workflowOutline(base, custom).find((p) => p.phase.key === phaseKey)?.steps.map((s) => s.item.id) ?? [];
}

function insertAfter(list: string[], id: string, after: string | null | undefined): string[] {
  const rest = list.filter((x) => x !== id);
  if (after === undefined) return [...rest, id];
  if (after === null) return [id, ...rest];
  const i = rest.indexOf(after);
  if (i < 0) throw new WorkflowChangeError(`There is no '${after}' to put it after`);
  return [...rest.slice(0, i + 1), id, ...rest.slice(i + 1)];
}

/**
 * The phases a project has already been through, and the one it is in, are
 * history: they keep their place and stay switched on, and nothing moves in
 * front of them. Otherwise completing the open phase would skip or repeat work.
 */
function lockedPrefix(base: WorkflowDefinition, custom: WorkflowCustomization, progress: ProjectProgress): string[] {
  const keys = applyCustomization(base, custom).phases.map((p) => p.key);
  const at = keys.indexOf(progress.currentPhase);
  return at < 0 ? [] : keys.slice(0, at + 1);
}

/**
 * Applies one change and returns the new overlay, or throws WorkflowChangeError
 * when the change is not allowed: removing a default phase or step, touching
 * phases the project is past, unknown modules, clashing ids and so on.
 */
export function applyWorkflowChange(
  base: WorkflowDefinition,
  current: WorkflowCustomization | undefined,
  progress: ProjectProgress,
  change: WorkflowChange
): WorkflowCustomization {
  const custom = current ?? EMPTY_CUSTOMIZATION;
  const outline = workflowOutline(base, custom);
  const findPhase = (k: string) => {
    const p = outline.find((x) => x.phase.key === k);
    if (!p) throw new WorkflowChangeError(`Unknown phase '${k}'`);
    return p;
  };
  const findStep = (id: string) => {
    for (const p of outline) {
      const s = p.steps.find((x) => x.item.id === id);
      if (s) return { phase: p, step: s };
    }
    throw new WorkflowChangeError(`Unknown step '${id}'`);
  };
  const locked = new Set(lockedPrefix(base, custom, progress));
  const past = (k: string) => locked.has(k);

  let next: WorkflowCustomization | undefined;
  switch (change.type) {
    case "setPhaseEnabled": {
      findPhase(change.phaseKey);
      if (!change.enabled && past(change.phaseKey)) {
        throw new WorkflowChangeError("A phase that is open or complete can't be switched off");
      }
      const { enabled: _was, ...rest } = custom.phases[change.phaseKey] ?? {};
      void _was;
      next = { ...custom, phases: { ...custom.phases, [change.phaseKey]: change.enabled ? rest : { ...rest, enabled: false } } };
      break;
    }
    case "addPhase": {
      if (outline.some((p) => p.phase.key === change.key)) throw new WorkflowChangeError(`Phase '${change.key}' already exists`);
      if (change.after) findPhase(change.after);
      const phase: CustomPhase = {
        key: change.key,
        name: change.name,
        description: change.description ?? "",
        modules: change.modules ?? ["checklist"],
      };
      next = {
        ...custom,
        customPhases: [...custom.customPhases, phase],
        phaseOrder: insertAfter(phaseOrderOf(base, custom), change.key, change.after),
      };
      break;
    }
    case "updatePhase": {
      const p = findPhase(change.phaseKey);
      if (p.fromDefinition) {
        const o = { ...custom.phases[change.phaseKey] };
        if (change.name !== undefined) o.name = change.name;
        if (change.description !== undefined) o.description = change.description;
        if (change.modules !== undefined) o.modules = change.modules;
        next = { ...custom, phases: { ...custom.phases, [change.phaseKey]: o } };
      } else {
        next = {
          ...custom,
          customPhases: custom.customPhases.map((cp) =>
            cp.key === change.phaseKey
              ? {
                  ...cp,
                  ...(change.name !== undefined ? { name: change.name } : {}),
                  ...(change.description !== undefined ? { description: change.description } : {}),
                  ...(change.modules !== undefined ? { modules: change.modules } : {}),
                }
              : cp
          ),
        };
      }
      break;
    }
    case "removePhase": {
      const p = findPhase(change.phaseKey);
      if (p.fromDefinition) throw new WorkflowChangeError("Default phases can be switched off, not removed");
      if (past(change.phaseKey)) throw new WorkflowChangeError("A phase that is open or complete can't be removed");
      const phases = { ...custom.phases };
      delete phases[change.phaseKey];
      const stepOrder = { ...custom.stepOrder };
      delete stepOrder[change.phaseKey];
      next = {
        ...custom,
        phases,
        stepOrder,
        customPhases: custom.customPhases.filter((cp) => cp.key !== change.phaseKey),
        customSteps: custom.customSteps.filter((s) => s.phaseKey !== change.phaseKey),
        phaseOrder: custom.phaseOrder?.filter((k) => k !== change.phaseKey),
      };
      break;
    }
    case "movePhase": {
      findPhase(change.phaseKey);
      if (change.after) findPhase(change.after);
      if (past(change.phaseKey)) throw new WorkflowChangeError("A phase that is open or complete can't be moved");
      next = { ...custom, phaseOrder: insertAfter(phaseOrderOf(base, custom), change.phaseKey, change.after) };
      break;
    }
    case "setStepEnabled": {
      const { step } = findStep(change.itemId);
      if (!step.fromDefinition) {
        if (change.enabled) break;
        throw new WorkflowChangeError("Steps you added are removed, not switched off");
      }
      const { enabled: _was, ...rest } = custom.steps[change.itemId] ?? {};
      void _was;
      next = { ...custom, steps: { ...custom.steps, [change.itemId]: change.enabled ? rest : { ...rest, enabled: false } } };
      break;
    }
    case "addStep": {
      findPhase(change.phaseKey);
      if (outline.some((p) => p.steps.some((s) => s.item.id === change.id))) {
        throw new WorkflowChangeError(`Step '${change.id}' already exists`);
      }
      const step: CustomStep = {
        id: change.id,
        phaseKey: change.phaseKey,
        text: change.text,
        essential: change.essential ?? false,
        ...(change.relativeDaysDue != null ? { relativeDaysDue: change.relativeDaysDue } : {}),
        ...(change.modules?.length ? { modules: change.modules } : {}),
      };
      next = { ...custom, customSteps: [...custom.customSteps, step] };
      break;
    }
    case "updateStep": {
      const { step } = findStep(change.itemId);
      if (step.fromDefinition) {
        const o = { ...custom.steps[change.itemId] };
        if (change.text !== undefined) o.text = change.text;
        if (change.essential !== undefined) o.essential = change.essential;
        if (change.relativeDaysDue !== undefined) o.relativeDaysDue = change.relativeDaysDue;
        if (change.modules !== undefined) o.modules = change.modules;
        next = { ...custom, steps: { ...custom.steps, [change.itemId]: o } };
      } else {
        next = {
          ...custom,
          customSteps: custom.customSteps.map((s) => {
            if (s.id !== change.itemId) return s;
            const u: CustomStep = { ...s };
            if (change.text !== undefined) u.text = change.text;
            if (change.essential !== undefined) u.essential = change.essential;
            if (change.relativeDaysDue !== undefined) {
              if (change.relativeDaysDue === null) delete u.relativeDaysDue;
              else u.relativeDaysDue = change.relativeDaysDue;
            }
            if (change.modules !== undefined) u.modules = change.modules;
            return u;
          }),
        };
      }
      break;
    }
    case "removeStep": {
      const { step, phase } = findStep(change.itemId);
      if (step.fromDefinition) throw new WorkflowChangeError("Default steps can be switched off, not removed");
      const order = custom.stepOrder[phase.phase.key];
      next = {
        ...custom,
        customSteps: custom.customSteps.filter((s) => s.id !== change.itemId),
        stepOrder: order ? { ...custom.stepOrder, [phase.phase.key]: order.filter((id) => id !== change.itemId) } : custom.stepOrder,
      };
      break;
    }
    case "moveStep": {
      const { phase } = findStep(change.itemId);
      if (change.after && !phase.steps.some((s) => s.item.id === change.after)) {
        throw new WorkflowChangeError("Steps can only be moved within their phase");
      }
      const order = insertAfter(stepOrderOf(base, custom, phase.phase.key), change.itemId, change.after);
      next = { ...custom, stepOrder: { ...custom.stepOrder, [phase.phase.key]: order } };
      break;
    }
  }
  next ??= custom;

  // The phases the project is past stay exactly where they were.
  const before = [...locked];
  const after = lockedPrefix(base, next, progress).slice(0, before.length);
  if (before.length && (before.length !== after.length || before.some((k, i) => after[i] !== k))) {
    throw new WorkflowChangeError("Phases can't be moved in front of the open phase");
  }

  if (!workflowOutline(base, next).some((p) => p.enabled)) {
    throw new WorkflowChangeError("A project needs at least one phase");
  }
  const resolved = applyCustomization(base, next);
  const check = validateWorkflowDefinition(resolved);
  if (!check.valid) throw new WorkflowChangeError(check.errors.join("; "));
  // Ids must stay unique across switched-off steps too, since ticks are stored by id.
  const ids = workflowOutline(base, next).flatMap((p) => p.steps.map((s) => s.item.id));
  if (new Set(ids).size !== ids.length) throw new WorkflowChangeError("Two steps share an id");
  return next;
}
