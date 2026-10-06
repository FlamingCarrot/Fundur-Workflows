import type { Db } from "@/lib/db";
import { readRoleModels, type DefaultModel, type ModelRole } from "./settings";

/**
 * Cost-aware routing (P4-13). Every AI call names a task type; each type runs
 * on a tier, the top model or the cheap worker model, and the Admin can move
 * a type between tiers. Worker output goes through the review gate, and each
 * type has a cap on how often review may send it back (P4-14).
 */

export type Tier = "top" | "worker";

export interface TaskType {
  key: string;
  label: string;
  description: string;
  defaultTier: Tier;
  /** False for work too small to be worth a review (its output is checked by the designer anyway). */
  reviewed?: boolean;
}

export const DEFAULT_MAX_RETRIES = 2;
export const MAX_RETRIES_LIMIT = 5;

const taskTypes = new Map<string, TaskType>();

/** Modules register the kinds of AI work they do; the routing page lists them all. */
export function registerTaskType(type: TaskType): void {
  taskTypes.set(type.key, type);
}

export function listTaskTypes(): TaskType[] {
  return [...taskTypes.values()];
}

export function getTaskType(key: string): TaskType | undefined {
  return taskTypes.get(key);
}

// The platform's own kinds of work. Modules add theirs next to their tools.
registerTaskType({
  key: "chat",
  label: "Assistant chat",
  description: "Talking with the designer and deciding which tools to use.",
  defaultTier: "top",
});
registerTaskType({
  key: "review",
  label: "Reviewing worker output",
  description: "The top model checks a worker's answer before it is used.",
  defaultTier: "top",
});

export interface TaskRoute {
  taskType: string;
  tier: Tier;
  maxRetries: number;
  /** True when the Admin set it; false when it is the type's default. */
  custom: boolean;
}

/** The chat and the review gate always run on the top model. */
const FIXED_TOP = new Set(["chat", "review"]);

export async function readTaskRoutes(db: Db): Promise<TaskRoute[]> {
  const rows = await db.query<{ task_type: string; tier: Tier; max_retries: number }>(
    "SELECT task_type, tier, max_retries FROM ai_task_routes WHERE workspace_id IS NULL"
  );
  const saved = new Map(rows.map((r) => [r.task_type, r]));
  return listTaskTypes().map((t) => {
    const row = saved.get(t.key);
    return {
      taskType: t.key,
      tier: FIXED_TOP.has(t.key) ? "top" : (row?.tier ?? t.defaultTier),
      maxRetries: row?.max_retries ?? DEFAULT_MAX_RETRIES,
      custom: !!row,
    };
  });
}

export async function readTaskRoute(db: Db, taskType: string): Promise<TaskRoute> {
  const known = getTaskType(taskType);
  const [row] = await db.query<{ tier: Tier; max_retries: number }>(
    "SELECT tier, max_retries FROM ai_task_routes WHERE workspace_id IS NULL AND task_type = $1",
    [taskType]
  );
  return {
    taskType,
    // Unknown task types run on the top model, the safe choice for quality.
    tier: FIXED_TOP.has(taskType) ? "top" : (row?.tier ?? known?.defaultTier ?? "top"),
    maxRetries: row?.max_retries ?? DEFAULT_MAX_RETRIES,
    custom: !!row,
  };
}

export async function saveTaskRoute(db: Db, taskType: string, tier: Tier, maxRetries: number, userId: string): Promise<void> {
  if (!getTaskType(taskType)) throw new Error(`Unknown task type '${taskType}'`);
  if (FIXED_TOP.has(taskType) && tier !== "top") throw new Error("The chat and the review gate always use the top model");
  const retries = Math.max(0, Math.min(MAX_RETRIES_LIMIT, Math.round(maxRetries)));
  await db.query(
    `INSERT INTO ai_task_routes (workspace_id, task_type, tier, max_retries, updated_by)
     VALUES (NULL, $1, $2, $3, $4)
     ON CONFLICT (task_type) WHERE workspace_id IS NULL DO UPDATE SET
       tier = EXCLUDED.tier, max_retries = EXCLUDED.max_retries, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [taskType, tier, retries, userId]
  );
}

export interface ModelChoice extends DefaultModel {
  role: ModelRole;
}

/**
 * The models to try for a tier, in order: its model, then its fallback. The
 * worker tier falls back to the top model's pair when no worker is set, so
 * everything works with a single model. Read on every call, so a change in
 * Settings takes effect on the next one.
 */
export async function modelsForTier(db: Db, tier: Tier): Promise<ModelChoice[]> {
  const roles = await readRoleModels(db);
  const pick = (...names: ModelRole[]) =>
    names.flatMap((role) => (roles[role] ? [{ ...roles[role]!, role }] : []));
  const top = pick("orchestrator", "orchestrator_fallback");
  if (tier === "top") return top;
  const workers = pick("worker", "worker_fallback");
  return workers.length ? workers : top;
}
