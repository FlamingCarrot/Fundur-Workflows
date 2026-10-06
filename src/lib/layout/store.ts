import type { Db } from "@/lib/db";
import { DEFAULT_RULES, DEFAULT_RULE_SET_NAME, normalizeRules, type LayoutRules, type RuleSet } from "./rules";

/**
 * Where a workspace's layout rule sets are kept (P4-01). A workspace always
 * has at least one: the first time its rules are asked for, the starting set
 * is saved for it.
 */

/** Someone else saved these rules since they were opened. */
export class RuleSetConflictError extends Error {
  constructor(public readonly current: RuleSet) {
    super("These rules were changed elsewhere since you opened them");
  }
}

export class RuleSetNotFoundError extends Error {}

interface Row {
  id: string;
  name: string;
  rules: Partial<LayoutRules>;
  revision: number;
  updated_at: Date | string;
  updated_name: string | null;
}

const SELECT = `SELECT s.id, s.name, s.rules, s.revision, s.updated_at, u.name AS updated_name
  FROM layout_rule_sets s LEFT JOIN users u ON u.id = s.updated_by`;

const toRuleSet = (r: Row): RuleSet => ({
  id: r.id,
  name: r.name,
  rules: normalizeRules(r.rules),
  revision: r.revision,
  updatedAt: new Date(r.updated_at).toISOString(),
  ...(r.updated_name ? { updatedBy: r.updated_name } : {}),
});

/** The workspace's rule sets, oldest first; the starting set is saved on the first call. */
export async function listRuleSets(db: Db, workspaceId: string, userId: string): Promise<RuleSet[]> {
  await db.query(
    `INSERT INTO layout_rule_sets (workspace_id, name, rules, created_by, updated_by)
     SELECT $1, $2, $3::jsonb, $4, $4
     WHERE NOT EXISTS (SELECT 1 FROM layout_rule_sets WHERE workspace_id = $1)`,
    [workspaceId, DEFAULT_RULE_SET_NAME, JSON.stringify(DEFAULT_RULES), userId]
  );
  const rows = await db.query<Row>(`${SELECT} WHERE s.workspace_id = $1 ORDER BY s.created_at, s.id`, [workspaceId]);
  return rows.map(toRuleSet);
}

async function getRuleSet(db: Db, workspaceId: string, id: string): Promise<RuleSet | null> {
  const [row] = await db.query<Row>(`${SELECT} WHERE s.workspace_id = $1 AND s.id = $2`, [workspaceId, id]);
  return row ? toRuleSet(row) : null;
}

export async function createRuleSet(
  db: Db,
  workspaceId: string,
  userId: string,
  input: { name: string; rules: LayoutRules }
): Promise<RuleSet> {
  const [row] = await db.query<{ id: string }>(
    `INSERT INTO layout_rule_sets (workspace_id, name, rules, created_by, updated_by)
     VALUES ($1, $2, $3::jsonb, $4, $4) RETURNING id`,
    [workspaceId, input.name, JSON.stringify(input.rules), userId]
  );
  return (await getRuleSet(db, workspaceId, row.id))!;
}

/** Saves the rules if nobody else saved them since `baseRevision`; otherwise throws with what is stored. */
export async function updateRuleSet(
  db: Db,
  workspaceId: string,
  userId: string,
  id: string,
  input: { name: string; rules: LayoutRules; baseRevision: number }
): Promise<RuleSet> {
  const rows = await db.query<{ id: string }>(
    `UPDATE layout_rule_sets SET name = $3, rules = $4::jsonb, revision = revision + 1, updated_by = $5, updated_at = NOW()
     WHERE workspace_id = $1 AND id = $2 AND revision = $6 RETURNING id`,
    [workspaceId, id, input.name, JSON.stringify(input.rules), userId, input.baseRevision]
  );
  const current = await getRuleSet(db, workspaceId, id);
  if (!current) throw new RuleSetNotFoundError("Those rules no longer exist");
  if (!rows.length) throw new RuleSetConflictError(current);
  return current;
}

/** Removes a rule set; the last one stays, so there is always one to lay out with. */
export async function deleteRuleSet(db: Db, workspaceId: string, id: string): Promise<void> {
  const rows = await db.query<{ id: string }>(
    // Locking the workspace's sets first makes two removals at once take turns,
    // so the second one counts what the first left and the last set stays.
    `WITH locked AS (SELECT id FROM layout_rule_sets WHERE workspace_id = $1 FOR UPDATE)
     DELETE FROM layout_rule_sets WHERE workspace_id = $1 AND id = $2
       AND (SELECT COUNT(*) FROM locked) > 1
     RETURNING id`,
    [workspaceId, id]
  );
  if (!rows.length) {
    if (!(await getRuleSet(db, workspaceId, id))) throw new RuleSetNotFoundError("Those rules no longer exist");
    throw new RuleSetConflictError((await getRuleSet(db, workspaceId, id))!);
  }
}
