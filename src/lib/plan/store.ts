import type { Db } from "@/lib/db";
import { projectDbId } from "@/lib/projects/store";
import type { Plan } from "./geometry";
import type { Correction, PlanState, PlanVersionSummary } from "./types";

/**
 * Where a project's floor plan is kept on the server (P3-06, P3-09): the
 * current geometry with its revision, named versions, and the corrections log.
 */

/** Someone else saved the plan since this editor loaded it. */
export class PlanConflictError extends Error {
  constructor(public readonly current: PlanState) {
    super("The plan was changed elsewhere since you opened it");
  }
}

export class PlanNotFoundError extends Error {}

const iso = (v: Date | string) => new Date(v).toISOString();

/** The plan, its revision, its versions and its latest corrections; null when the project does not exist. */
export async function getPlanState(db: Db, workspaceId: string, slug: string): Promise<PlanState | null> {
  const projectId = await projectDbId(db, workspaceId, slug);
  if (!projectId) return null;
  return stateFor(db, workspaceId, projectId);
}

async function stateFor(db: Db, workspaceId: string, projectId: string): Promise<PlanState> {
  const [row] = await db.query<{ geometry: Plan; revision: number; updated_at: Date | string; name: string | null }>(
    `SELECT f.geometry, f.revision, f.updated_at, u.name FROM floor_plans f LEFT JOIN users u ON u.id = f.updated_by
     WHERE f.workspace_id = $1 AND f.project_id = $2`,
    [workspaceId, projectId]
  );
  const versions = await db.query<{ id: string; label: string; created_at: Date | string; name: string | null }>(
    `SELECT v.id, v.label, v.created_at, u.name FROM floor_plan_versions v LEFT JOIN users u ON u.id = v.created_by
     WHERE v.workspace_id = $1 AND v.project_id = $2 ORDER BY v.created_at DESC, v.id LIMIT 200`,
    [workspaceId, projectId]
  );
  const corrections = await db.query<{ id: string; summary: string; created_at: Date | string; name: string | null; email: string | null }>(
    `SELECT c.id, c.summary, c.created_at, u.name, u.email FROM floor_plan_corrections c LEFT JOIN users u ON u.id = c.created_by
     WHERE c.workspace_id = $1 AND c.project_id = $2 ORDER BY c.created_at DESC, c.revision DESC, c.id LIMIT 200`,
    [workspaceId, projectId]
  );
  return {
    plan: row?.geometry ?? null,
    revision: row?.revision ?? 0,
    ...(row ? { updatedAt: iso(row.updated_at), updatedBy: row.name ?? undefined } : {}),
    versions: versions.map(
      (v): PlanVersionSummary => ({ id: v.id, label: v.label, createdAt: iso(v.created_at), ...(v.name ? { createdBy: v.name } : {}) })
    ),
    corrections: corrections.map(
      (c): Correction => ({ id: c.id, summary: c.summary, at: iso(c.created_at), by: c.name || c.email || "Someone" })
    ),
  };
}

/**
 * Saves the plan if nobody else saved it since `baseRevision`, and logs each
 * change. Throws PlanConflictError with the stored plan when someone did.
 */
export async function savePlan(
  db: Db,
  workspaceId: string,
  userId: string,
  slug: string,
  input: { plan: Plan; baseRevision: number | null; changes: string[] }
): Promise<{ revision: number }> {
  const projectId = await projectDbId(db, workspaceId, slug);
  if (!projectId) throw new PlanNotFoundError("Project not found");
  return writePlan(db, workspaceId, userId, projectId, input);
}

async function writePlan(
  db: Db,
  workspaceId: string,
  userId: string,
  projectId: string,
  input: { plan: Plan; baseRevision: number | null; changes: string[] }
): Promise<{ revision: number }> {
  const geometry = JSON.stringify(input.plan);
  // A single statement each way, so two saves racing cannot both win.
  const rows = input.baseRevision
    ? await db.query<{ revision: number }>(
        `UPDATE floor_plans SET geometry = $3::jsonb, revision = revision + 1, updated_by = $4, updated_at = NOW()
         WHERE workspace_id = $1 AND project_id = $2 AND revision = $5 RETURNING revision`,
        [workspaceId, projectId, geometry, userId, input.baseRevision]
      )
    : await db.query<{ revision: number }>(
        `INSERT INTO floor_plans (project_id, workspace_id, geometry, revision, updated_by)
         VALUES ($2, $1, $3::jsonb, 1, $4) ON CONFLICT (project_id) DO NOTHING RETURNING revision`,
        [workspaceId, projectId, geometry, userId]
      );
  if (!rows.length) throw new PlanConflictError(await stateFor(db, workspaceId, projectId));
  const revision = rows[0].revision;

  const changes = input.changes.filter(Boolean);
  if (changes.length) {
    const values: unknown[] = [];
    const tuples = changes.map((summary, i) => {
      values.push(summary.slice(0, 1_000));
      return `($1, $2, $${i + 5}, $3, $4, NOW() + make_interval(secs => ${i} * 0.001))`;
    });
    await db.query(
      `INSERT INTO floor_plan_corrections (workspace_id, project_id, summary, revision, created_by, created_at) VALUES ${tuples.join(", ")}`,
      [workspaceId, projectId, revision, userId, ...values]
    );
  }
  return { revision };
}

/** Keeps the plan as it is now under a name, so it can be compared with or gone back to. */
export async function createPlanVersion(
  db: Db,
  workspaceId: string,
  userId: string,
  slug: string,
  label: string
): Promise<PlanVersionSummary> {
  const projectId = await projectDbId(db, workspaceId, slug);
  if (!projectId) throw new PlanNotFoundError("Project not found");
  return versionFor(db, workspaceId, userId, projectId, label);
}

async function versionFor(db: Db, workspaceId: string, userId: string, projectId: string, label: string): Promise<PlanVersionSummary> {
  const [row] = await db.query<{ id: string; created_at: Date | string }>(
    `INSERT INTO floor_plan_versions (workspace_id, project_id, label, geometry, created_by)
     SELECT workspace_id, project_id, $3, geometry, $4 FROM floor_plans WHERE workspace_id = $1 AND project_id = $2
     RETURNING id, created_at`,
    [workspaceId, projectId, label.slice(0, 255), userId]
  );
  if (!row) throw new PlanNotFoundError("There is no plan to keep a version of yet");
  return { id: row.id, label, createdAt: iso(row.created_at) };
}

export async function getPlanVersion(
  db: Db,
  workspaceId: string,
  slug: string,
  versionId: string
): Promise<{ id: string; label: string; createdAt: string; plan: Plan } | null> {
  const projectId = await projectDbId(db, workspaceId, slug);
  if (!projectId) return null;
  const [row] = await db.query<{ id: string; label: string; created_at: Date | string; geometry: Plan }>(
    `SELECT id, label, created_at, geometry FROM floor_plan_versions WHERE workspace_id = $1 AND project_id = $2 AND id = $3`,
    [workspaceId, projectId, versionId]
  );
  return row ? { id: row.id, label: row.label, createdAt: iso(row.created_at), plan: row.geometry } : null;
}

/**
 * Puts a named version back as the current plan. The plan as it stood is kept
 * first as its own version, so a restore can always be undone.
 */
export async function restorePlanVersion(
  db: Db,
  workspaceId: string,
  userId: string,
  slug: string,
  versionId: string,
  baseRevision: number
): Promise<PlanState> {
  const projectId = await projectDbId(db, workspaceId, slug);
  if (!projectId) throw new PlanNotFoundError("Project not found");
  const version = await getPlanVersion(db, workspaceId, slug, versionId);
  if (!version) throw new PlanNotFoundError("That version no longer exists");
  const current = await stateFor(db, workspaceId, projectId);
  if (current.revision !== baseRevision) throw new PlanConflictError(current);
  await versionFor(db, workspaceId, userId, projectId, `Before restoring "${version.label}"`);
  await writePlan(db, workspaceId, userId, projectId, {
    plan: version.plan,
    baseRevision,
    changes: [`Restored version "${version.label}"`],
  });
  return stateFor(db, workspaceId, projectId);
}
