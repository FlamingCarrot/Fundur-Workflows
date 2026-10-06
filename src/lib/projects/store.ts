import type { Db } from "@/lib/db";
import { getForm, getWorkflow, listWorkflows } from "@/lib/workflow";
import { completePhase, newProject } from "@/lib/studio/transitions";
import type { Project, ProjectDocument, ProjectStatus, SwatchKey, WaitingOn } from "@/lib/studio/types";
import type { NewProjectRequest, ProjectMutation } from "./mutations";

/**
 * Projects in Postgres. Every query is scoped to one workspace, so a project
 * is only ever read or changed by members of the workspace that owns it.
 */

interface ProjectRow {
  id: string;
  slug: string;
  name: string;
  client_name: string;
  swatch: string;
  workflow_id: string;
  workflow_version: number;
  status: string;
  waiting_on: string;
  start_date: Date | string;
  current_phase_key: string;
  completed_phases: string[];
  checks: Record<string, boolean>;
  brief: Record<string, string>;
  brief_ai_fields: string[];
  ai_spend_zar: string | number;
  last_activity_at: Date | string;
}

interface DocumentRow {
  id: string;
  project_id: string;
  name: string;
  size_bytes: string | number;
  phase_key: string | null;
  client_visible: boolean;
  created_at: Date | string;
}

export class MutationError extends Error {}

const iso = (v: Date | string) => (v instanceof Date ? v : new Date(v)).toISOString();

function toDocument(row: DocumentRow): ProjectDocument {
  return {
    id: row.id,
    name: row.name,
    sizeBytes: Number(row.size_bytes),
    phaseKey: row.phase_key ?? "",
    uploadedAt: iso(row.created_at),
    clientVisible: row.client_visible,
  };
}

function toProject(row: ProjectRow, documents: ProjectDocument[]): Project {
  return {
    id: row.slug,
    name: row.name,
    client: row.client_name,
    swatch: row.swatch as SwatchKey,
    workflowId: row.workflow_id,
    workflowVersion: row.workflow_version,
    status: row.status as ProjectStatus,
    waitingOn: row.waiting_on as WaitingOn,
    startDate: iso(row.start_date),
    currentPhase: row.current_phase_key,
    completedPhases: row.completed_phases,
    checks: row.checks,
    brief: row.brief,
    briefAiFields: row.brief_ai_fields,
    documents,
    aiSpendZar: Number(row.ai_spend_zar),
    lastActivity: iso(row.last_activity_at),
  };
}

const PROJECT_COLUMNS = `id, slug, name, client_name, swatch, workflow_id, workflow_version, status, waiting_on,
  start_date, current_phase_key, completed_phases, checks, brief, brief_ai_fields, ai_spend_zar, last_activity_at`;
const DOCUMENT_COLUMNS = "id, project_id, name, size_bytes, phase_key, client_visible, created_at";

async function withDocuments(db: Db, workspaceId: string, rows: ProjectRow[]): Promise<Project[]> {
  if (!rows.length) return [];
  const docs = await db.query<DocumentRow>(
    `SELECT ${DOCUMENT_COLUMNS} FROM documents
     WHERE workspace_id = $1 AND project_id = ANY($2::uuid[])
     ORDER BY created_at DESC, id`,
    [workspaceId, rows.map((r) => r.id)]
  );
  return rows.map((row) => toProject(row, docs.filter((d) => d.project_id === row.id).map(toDocument)));
}

/** The workspace's projects, newest first. */
export async function listProjects(db: Db, workspaceId: string): Promise<Project[]> {
  const rows = await db.query<ProjectRow>(
    `SELECT ${PROJECT_COLUMNS} FROM projects WHERE workspace_id = $1 ORDER BY created_at DESC, id`,
    [workspaceId]
  );
  return withDocuments(db, workspaceId, rows);
}

/** One project by its slug, or null when the workspace has none by that slug. */
export async function getProject(db: Db, workspaceId: string, slug: string): Promise<Project | null> {
  const rows = await db.query<ProjectRow>(
    `SELECT ${PROJECT_COLUMNS} FROM projects WHERE workspace_id = $1 AND slug = $2`,
    [workspaceId, slug]
  );
  const [project] = await withDocuments(db, workspaceId, rows);
  return project ?? null;
}

/**
 * Creates a project under the slug the browser chose. If the workspace already
 * has that slug (two tabs creating at once), it gets a suffix instead, and the
 * returned project carries the slug it was saved under.
 */
export async function createProject(db: Db, workspaceId: string, input: NewProjectRequest): Promise<Project> {
  if (!listWorkflows().some((w) => w.id === input.workflowId)) {
    throw new MutationError(`Unknown workflow '${input.workflowId}'`);
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    const slug = attempt === 0 ? input.id : `${input.id.slice(0, 90)}-${Math.random().toString(36).slice(2, 8)}`;
    const p = newProject({ ...input, id: slug });
    const inserted = await db.query(
      `INSERT INTO projects (workspace_id, slug, name, client_name, swatch, workflow_id, workflow_version,
         status, waiting_on, start_date, current_phase_key, brief)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
       ON CONFLICT (workspace_id, slug) DO NOTHING
       RETURNING id`,
      [workspaceId, slug, p.name, p.client, p.swatch, p.workflowId, p.workflowVersion, p.status, p.waitingOn,
        p.startDate, p.currentPhase, JSON.stringify(p.brief)]
    );
    if (inserted.length) return (await getProject(db, workspaceId, slug))!;
  }
  throw new MutationError("Could not find a free project id");
}

function fileType(name: string): string {
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  return ext.slice(0, 100) || "file";
}

/** Bumps the project's activity time; every change does. */
const TOUCH = "last_activity_at = NOW(), updated_at = NOW()";

/**
 * Applies one change to a project and returns the project as saved, or null
 * when the workspace has no such project. Each change is a single statement
 * that edits only what it names, so concurrent edits to other parts survive.
 */
export async function applyMutation(
  db: Db,
  workspaceId: string,
  slug: string,
  m: ProjectMutation
): Promise<Project | null> {
  const project = await getProject(db, workspaceId, slug);
  if (!project) return null;
  const workflow = getWorkflow(project);
  const where = "workspace_id = $1 AND slug = $2";

  switch (m.type) {
    case "setCheck": {
      if (!workflow.phases.some((ph) => ph.checklist.some((i) => i.id === m.itemId))) {
        throw new MutationError(`Unknown checklist item '${m.itemId}'`);
      }
      await db.query(
        `UPDATE projects SET checks = checks || jsonb_build_object($3::text, $4::boolean), ${TOUCH} WHERE ${where}`,
        [workspaceId, slug, m.itemId, m.done]
      );
      break;
    }
    case "setWaitingOn":
      await db.query(`UPDATE projects SET waiting_on = $3, ${TOUCH} WHERE ${where}`, [workspaceId, slug, m.waitingOn]);
      break;
    case "setStatus":
      // Finishing a project goes through its last phase; a finished one stays finished.
      await db.query(`UPDATE projects SET status = $3, ${TOUCH} WHERE ${where} AND status <> 'complete'`, [
        workspaceId,
        slug,
        m.status,
      ]);
      break;
    case "updateBrief": {
      const known = new Set((getForm(project, "brief")?.fields ?? []).map((f) => f.key));
      const fields = Object.keys(m.patch);
      const unknown = fields.find((f) => !known.has(f));
      if (unknown) throw new MutationError(`Unknown brief field '${unknown}'`);
      await db.query(
        `UPDATE projects SET
           brief = brief || $3::jsonb,
           brief_ai_fields = CASE WHEN $5::boolean
             THEN ARRAY(SELECT DISTINCT f FROM unnest(brief_ai_fields || $4::text[]) AS f ORDER BY f)
             ELSE ARRAY(SELECT f FROM unnest(brief_ai_fields) AS f WHERE f <> ALL($4::text[]))
           END,
           ${TOUCH}
         WHERE ${where}`,
        [workspaceId, slug, JSON.stringify(m.patch), fields, m.fromAi]
      );
      break;
    }
    case "addDocuments": {
      const phaseKeys = new Set(workflow.phases.map((ph) => ph.key));
      const bad = m.documents.find((d) => !phaseKeys.has(d.phaseKey));
      if (bad) throw new MutationError(`Unknown phase '${bad.phaseKey}'`);
      const docs = m.documents.map((d) => ({ ...d, fileType: fileType(d.name) }));
      await db.query(
        `WITH p AS (
           UPDATE projects SET ${TOUCH} WHERE ${where} RETURNING id, workspace_id
         )
         INSERT INTO documents (id, project_id, workspace_id, name, file_type, file_location, size_bytes,
           client_visible, phase_key, created_at)
         SELECT d."id", p.id, p.workspace_id, d."name", d."fileType", '', d."sizeBytes", d."clientVisible",
           d."phaseKey", d."uploadedAt"
         FROM p, jsonb_to_recordset($3::jsonb) AS d(
           "id" uuid, "name" text, "fileType" text, "sizeBytes" bigint, "clientVisible" boolean,
           "phaseKey" text, "uploadedAt" timestamptz)
         ON CONFLICT (id) DO NOTHING`,
        [workspaceId, slug, JSON.stringify(docs)]
      );
      break;
    }
    case "setClientVisible":
      await db.query(
        `WITH p AS (
           UPDATE projects SET ${TOUCH} WHERE ${where} RETURNING id
         )
         UPDATE documents SET client_visible = $4, updated_at = NOW()
         FROM p WHERE documents.project_id = p.id AND documents.workspace_id = $1 AND documents.id = $3`,
        [workspaceId, slug, m.documentId, m.clientVisible]
      );
      break;
    case "completePhase": {
      const next = completePhase(project, m.phaseKey);
      if (next === project) break;
      // Guarded on the phase still being open, so two completions at once advance it only once.
      await db.query(
        `UPDATE projects SET completed_phases = $4, current_phase_key = $5, status = $6, ${TOUCH}
         WHERE ${where} AND current_phase_key = $3 AND status <> 'complete'`,
        [workspaceId, slug, m.phaseKey, next.completedPhases, next.currentPhase, next.status]
      );
      break;
    }
    case "addAiSpend":
      await db.query(`UPDATE projects SET ai_spend_zar = ai_spend_zar + $3, ${TOUCH} WHERE ${where}`, [
        workspaceId,
        slug,
        m.zar,
      ]);
      break;
  }

  return getProject(db, workspaceId, slug);
}
