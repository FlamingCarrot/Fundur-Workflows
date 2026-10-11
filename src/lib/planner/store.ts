import type { Db } from "@/lib/db";
import { applyPlannerOp, emptyPlanner, normalizePlanner, type PlannerOp, type PlannerState } from "./state";

/**
 * Where each person's planner is kept, one row per person per workspace. A
 * change is applied to the latest saved copy and written only if nobody saved
 * in between; otherwise it is applied again on top of theirs.
 */

export interface SavedPlanner {
  state: PlannerState;
  revision: number;
}

export async function getPlanner(db: Db, workspaceId: string, userId: string): Promise<SavedPlanner> {
  const [row] = await db.query<{ state: PlannerState; revision: number }>(
    "SELECT state, revision FROM planner_states WHERE workspace_id = $1 AND user_id = $2",
    [workspaceId, userId]
  );
  return row ? { state: normalizePlanner(row.state), revision: row.revision } : { state: emptyPlanner(), revision: 0 };
}

/** Applies the changes in order and saves them together. Throws PlannerError when one does not fit. */
export async function changePlanner(db: Db, workspaceId: string, userId: string, ops: PlannerOp[]): Promise<SavedPlanner> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const current = await getPlanner(db, workspaceId, userId);
    const state = ops.reduce((s, op) => applyPlannerOp(s, op), current.state);
    const saved =
      current.revision === 0
        ? await db.query(
            `INSERT INTO planner_states (workspace_id, user_id, state, revision) VALUES ($1, $2, $3::jsonb, 1)
             ON CONFLICT DO NOTHING RETURNING revision`,
            [workspaceId, userId, JSON.stringify(state)]
          )
        : await db.query(
            `UPDATE planner_states SET state = $3::jsonb, revision = revision + 1, updated_at = NOW()
             WHERE workspace_id = $1 AND user_id = $2 AND revision = $4 RETURNING revision`,
            [workspaceId, userId, JSON.stringify(state), current.revision]
          );
    if (saved.length) return { state, revision: current.revision + 1 };
  }
  throw new Error("Your planner is being changed elsewhere; try again");
}
