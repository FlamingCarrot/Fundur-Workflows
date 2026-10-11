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
  /** Tokens read and written, which is how people who are not the Admin see usage. */
  tokens: number;
  inputTokens: number;
  outputTokens: number;
}

/** How often the assistant ran one tool on the project. */
export interface ToolLine {
  key: string;
  label: string;
  calls: number;
  failed: number;
  /** Average time it took, in milliseconds. */
  avgMs: number;
}

export interface ProjectAiCosts {
  totalZar: number;
  totalUsd: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  calls: number;
  failedCalls: number;
  byPhase: CostLine[];
  byTask: CostLine[];
  byTaskType: CostLine[];
  byModel: CostLine[];
  /** The orchestrator's own turns, workers and reviews. */
  byRole: CostLine[];
  /** Every tool the assistant ran, most used first. */
  byTool: ToolLine[];
}

type Row = {
  key: string | null;
  zar: string | number;
  usd: string | number;
  calls: string | number;
  failed: string | number;
  input: string | number;
  output: string | number;
};

const ROLE_LABELS: Record<string, string> = {
  orchestrator: "Assistant (top model)",
  worker: "Workers",
  reviewer: "Reviews of worker output",
};

export async function projectAiCosts(
  db: Db,
  workspaceId: string,
  projectId: string,
  names: { phase: (key: string) => string; task: (id: string) => string; tool?: (name: string) => string }
): Promise<ProjectAiCosts> {
  const group = (column: string) =>
    db.query<Row>(
      `SELECT ${column} AS key, COALESCE(SUM(cost_zar), 0) AS zar, COALESCE(SUM(cost_usd), 0) AS usd,
         COUNT(*) AS calls, COUNT(*) FILTER (WHERE outcome = 'failed') AS failed,
         COALESCE(SUM(prompt_tokens), 0) AS input, COALESCE(SUM(completion_tokens), 0) AS output
       FROM ai_runs WHERE workspace_id = $1 AND project_id = $2
       GROUP BY ${column} ORDER BY SUM(cost_zar) DESC, ${column}`,
      [workspaceId, projectId]
    );
  const [phases, tasks, types, models, roles, tools] = await Promise.all([
    group("phase_key"),
    group("task_ref"),
    group("task_name"),
    group("model_name"),
    group("role"),
    db.query<{ key: string; calls: string | number; failed: string | number; avg_ms: string | number }>(
      `SELECT tool_name AS key, COUNT(*) AS calls, COUNT(*) FILTER (WHERE NOT ok) AS failed, COALESCE(AVG(duration_ms), 0) AS avg_ms
       FROM ai_tool_calls WHERE workspace_id = $1 AND project_id = $2
       GROUP BY tool_name ORDER BY COUNT(*) DESC, tool_name`,
      [workspaceId, projectId]
    ),
  ]);
  const line = (r: Row, label: string): CostLine => ({
    key: r.key ?? "",
    label,
    zar: Number(r.zar),
    calls: Number(r.calls),
    tokens: Number(r.input) + Number(r.output),
    inputTokens: Number(r.input),
    outputTokens: Number(r.output),
  });
  const sum = (pick: (r: Row) => string | number) => phases.reduce((s, r) => s + Number(pick(r)), 0);
  return {
    totalZar: sum((r) => r.zar),
    totalUsd: sum((r) => r.usd),
    totalTokens: sum((r) => r.input) + sum((r) => r.output),
    inputTokens: sum((r) => r.input),
    outputTokens: sum((r) => r.output),
    calls: phases.reduce((s, r) => s + Number(r.calls), 0),
    failedCalls: phases.reduce((s, r) => s + Number(r.failed), 0),
    byPhase: phases.map((r) => line(r, r.key ? names.phase(r.key) : "Not tied to a phase")),
    byTask: tasks.filter((r) => r.key).map((r) => line(r, names.task(r.key!))),
    byTaskType: types.map((r) => line(r, getTaskType(r.key ?? "")?.label ?? r.key ?? "Other")),
    byModel: models.map((r) => line(r, r.key ?? "Unknown")),
    byRole: roles.map((r) => line(r, ROLE_LABELS[r.key ?? ""] ?? r.key ?? "Other")),
    byTool: tools.map((r) => ({
      key: r.key,
      label: names.tool?.(r.key) ?? r.key,
      calls: Number(r.calls),
      failed: Number(r.failed),
      avgMs: Math.round(Number(r.avg_ms)),
    })),
  };
}

/** The same breakdown with every money figure taken out, for people who see usage in tokens only. */
export function withoutMoney(costs: ProjectAiCosts): ProjectAiCosts {
  const strip = (l: CostLine): CostLine => ({ ...l, zar: 0 });
  return {
    ...costs,
    totalZar: 0,
    totalUsd: 0,
    byPhase: costs.byPhase.map(strip),
    byTask: costs.byTask.map(strip),
    byTaskType: costs.byTaskType.map(strip),
    byModel: costs.byModel.map(strip),
    byRole: costs.byRole.map(strip),
  };
}
