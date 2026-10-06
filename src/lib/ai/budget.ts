import type { Db } from "@/lib/db";

/**
 * A per-project AI budget (P4-16). An alert fires once when spend crosses the
 * alert share of the budget and once when it reaches the budget; raising the
 * budget lets them fire again. With "pause at limit" on, no new AI call starts
 * on the project once the budget is used up, so a loop cannot run away.
 */

export interface ProjectBudget {
  budgetZar: number | null;
  alertPercent: number;
  pauseAtLimit: boolean;
  spentZar: number;
}

export interface BudgetAlert {
  id: string;
  level: "threshold" | "limit";
  spendZar: number;
  budgetZar: number;
  createdAt: string;
}

/** AI calls on this project are paused: its budget is used up. */
export class AiBudgetError extends Error {}

const iso = (v: Date | string) => new Date(v).toISOString();

export async function projectSpendZar(db: Db, projectId: string): Promise<number> {
  const [row] = await db.query<{ total: string | number }>(
    "SELECT COALESCE(SUM(cost_zar), 0) AS total FROM ai_runs WHERE project_id = $1",
    [projectId]
  );
  return Number(row?.total ?? 0);
}

export async function readBudget(db: Db, workspaceId: string, projectId: string): Promise<ProjectBudget> {
  const [row] = await db.query<{ budget_zar: string | number; alert_percent: number; pause_at_limit: boolean }>(
    "SELECT budget_zar, alert_percent, pause_at_limit FROM project_ai_budgets WHERE workspace_id = $1 AND project_id = $2",
    [workspaceId, projectId]
  );
  return {
    budgetZar: row ? Number(row.budget_zar) : null,
    alertPercent: row?.alert_percent ?? 80,
    pauseAtLimit: row?.pause_at_limit ?? true,
    spentZar: await projectSpendZar(db, projectId),
  };
}

/** Sets the budget, or removes it with null. Returns any alert the new budget already crosses. */
export async function saveBudget(
  db: Db,
  workspaceId: string,
  projectId: string,
  input: { budgetZar: number | null; alertPercent: number; pauseAtLimit: boolean },
  userId: string
): Promise<BudgetAlert[]> {
  if (input.budgetZar == null) {
    await db.query("DELETE FROM project_ai_budgets WHERE workspace_id = $1 AND project_id = $2", [workspaceId, projectId]);
    return [];
  }
  await db.query(
    `INSERT INTO project_ai_budgets (project_id, workspace_id, budget_zar, alert_percent, pause_at_limit, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (project_id) DO UPDATE SET budget_zar = EXCLUDED.budget_zar, alert_percent = EXCLUDED.alert_percent,
       pause_at_limit = EXCLUDED.pause_at_limit, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [projectId, workspaceId, input.budgetZar, Math.max(1, Math.min(100, Math.round(input.alertPercent))), input.pauseAtLimit, userId]
  );
  return checkBudget(db, workspaceId, projectId);
}

/**
 * Fires the alerts that spend has crossed and not yet fired for this budget.
 * Called after every logged AI call; returns only the alerts it just fired.
 */
export async function checkBudget(db: Db, workspaceId: string, projectId: string): Promise<BudgetAlert[]> {
  const budget = await readBudget(db, workspaceId, projectId);
  if (budget.budgetZar == null || budget.budgetZar <= 0) return [];
  const crossed: BudgetAlert["level"][] = [];
  if (budget.spentZar >= (budget.budgetZar * budget.alertPercent) / 100) crossed.push("threshold");
  if (budget.spentZar >= budget.budgetZar) crossed.push("limit");
  const fired: BudgetAlert[] = [];
  for (const level of crossed) {
    const rows = await db.query<{ id: string; created_at: Date | string }>(
      `INSERT INTO ai_budget_alerts (workspace_id, project_id, level, spend_zar, budget_zar)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (project_id, level, budget_zar) DO NOTHING
       RETURNING id, created_at`,
      [workspaceId, projectId, level, budget.spentZar, budget.budgetZar]
    );
    if (rows.length) fired.push({ id: rows[0].id, level, spendZar: budget.spentZar, budgetZar: budget.budgetZar, createdAt: iso(rows[0].created_at) });
  }
  return fired;
}

/** Throws AiBudgetError when the project's budget is used up and set to pause AI. */
export async function assertWithinBudget(db: Db, workspaceId: string, projectId: string): Promise<void> {
  const budget = await readBudget(db, workspaceId, projectId);
  if (budget.budgetZar != null && budget.pauseAtLimit && budget.spentZar >= budget.budgetZar) {
    throw new AiBudgetError(
      `This project's AI budget of R${budget.budgetZar.toFixed(2)} is used up, so AI is paused. The Admin can raise it.`
    );
  }
}

/** Alerts not yet dismissed, newest first. */
export async function openAlerts(db: Db, workspaceId: string, projectId: string): Promise<BudgetAlert[]> {
  const rows = await db.query<{ id: string; level: BudgetAlert["level"]; spend_zar: string | number; budget_zar: string | number; created_at: Date | string }>(
    `SELECT id, level, spend_zar, budget_zar, created_at FROM ai_budget_alerts
     WHERE workspace_id = $1 AND project_id = $2 AND dismissed_at IS NULL ORDER BY created_at DESC, level DESC`,
    [workspaceId, projectId]
  );
  return rows.map((r) => ({ id: r.id, level: r.level, spendZar: Number(r.spend_zar), budgetZar: Number(r.budget_zar), createdAt: iso(r.created_at) }));
}

export async function dismissAlert(db: Db, workspaceId: string, alertId: string): Promise<boolean> {
  const rows = await db.query(
    "UPDATE ai_budget_alerts SET dismissed_at = NOW() WHERE workspace_id = $1 AND id = $2 AND dismissed_at IS NULL RETURNING id",
    [workspaceId, alertId]
  );
  return rows.length > 0;
}
