import type { Db } from "@/lib/db";
import { getTaskType } from "./routing";

/**
 * AI cost per project, phase, task and kind of work (P4-15). Every figure is
 * a sum of the call log, so the parts always add up to the project total.
 */

export interface CostLine {
  key: string;
  label: string;
  zar: number;
  calls: number;
}

export interface ProjectAiCosts {
  totalZar: number;
  totalUsd: number;
  calls: number;
  failedCalls: number;
  byPhase: CostLine[];
  byTask: CostLine[];
  byTaskType: CostLine[];
  byModel: CostLine[];
}

type Row = { key: string | null; zar: string | number; usd: string | number; calls: string | number; failed: string | number };

export async function projectAiCosts(
  db: Db,
  workspaceId: string,
  projectId: string,
  names: { phase: (key: string) => string; task: (id: string) => string }
): Promise<ProjectAiCosts> {
  const group = (column: string) =>
    db.query<Row>(
      `SELECT ${column} AS key, COALESCE(SUM(cost_zar), 0) AS zar, COALESCE(SUM(cost_usd), 0) AS usd,
         COUNT(*) AS calls, COUNT(*) FILTER (WHERE outcome = 'failed') AS failed
       FROM ai_runs WHERE workspace_id = $1 AND project_id = $2
       GROUP BY ${column} ORDER BY SUM(cost_zar) DESC, ${column}`,
      [workspaceId, projectId]
    );
  const [phases, tasks, types, models] = await Promise.all([
    group("phase_key"),
    group("task_id::text"),
    group("task_name"),
    group("model_name"),
  ]);
  const line = (r: Row, label: string): CostLine => ({ key: r.key ?? "", label, zar: Number(r.zar), calls: Number(r.calls) });
  return {
    totalZar: phases.reduce((s, r) => s + Number(r.zar), 0),
    totalUsd: phases.reduce((s, r) => s + Number(r.usd), 0),
    calls: phases.reduce((s, r) => s + Number(r.calls), 0),
    failedCalls: phases.reduce((s, r) => s + Number(r.failed), 0),
    byPhase: phases.map((r) => line(r, r.key ? names.phase(r.key) : "Not tied to a phase")),
    byTask: tasks.filter((r) => r.key).map((r) => line(r, names.task(r.key!))),
    byTaskType: types.map((r) => line(r, getTaskType(r.key ?? "")?.label ?? r.key ?? "Other")),
    byModel: models.map((r) => line(r, r.key ?? "Unknown")),
  };
}
