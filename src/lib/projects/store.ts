import type { Db } from "@/lib/db";
import { getForm, getWorkflow, listWorkflows } from "@/lib/workflow";
import { completePhase, newProject } from "@/lib/studio/transitions";
import type { Project, ProjectDocument, ProjectStatus, SwatchKey, TaskRecord, WaitingOn } from "@/lib/studio/types";
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
  brief_cost_zar: string | number;
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
  file_location: string;
  version_number: number;
}

interface TaskRow {
  id: string;
  project_id: string;
  step_item_id: string | null;
  phase_key: string;
  title: string;
  due_date: Date | string | null;
  done: boolean;
  output_document_id: string | null;
}

export class MutationError extends Error {}

/** The AI run task name for drafting a brief from notes. */
export const BRIEF_DRAFT_TASK = "brief_draft";

const iso = (v: Date | string) => (v instanceof Date ? v : new Date(v)).toISOString();

function toDocument(row: DocumentRow): ProjectDocument {
  return {
    id: row.id,
    name: row.name,
    sizeBytes: Number(row.size_bytes),
    phaseKey: row.phase_key ?? "",
    uploadedAt: iso(row.created_at),
    clientVisible: row.client_visible,
    stored: row.file_location !== "",
    version: row.version_number,
  };
}

/** A date column as the day it names, without a time zone shifting it. */
function day(value: Date | string): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function toTask(row: TaskRow): TaskRecord {
  return {
    id: row.id,
    ...(row.step_item_id ? { stepItemId: row.step_item_id } : {}),
    phaseKey: row.phase_key,
    title: row.title,
    ...(row.due_date ? { due: day(row.due_date) } : {}),
    done: row.done,
    ...(row.output_document_id ? { outputDocumentId: row.output_document_id } : {}),
  };
}

function toProject(row: ProjectRow, documents: ProjectDocument[], tasks: TaskRecord[]): Project {
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
    tasks,
    aiSpendZar: Number(row.ai_spend_zar),
    briefCostZar: Number(row.brief_cost_zar),
    lastActivity: iso(row.last_activity_at),
  };
}

// AI costs are sums of the call log (ai_runs), so what the app shows always matches it.
const PROJECT_COLUMNS = `id, slug, name, client_name, swatch, workflow_id, workflow_version, status, waiting_on,
  start_date, current_phase_key, completed_phases, checks, brief, brief_ai_fields, last_activity_at,
  (SELECT COALESCE(SUM(r.cost_zar), 0) FROM ai_runs r WHERE r.project_id = projects.id) AS ai_spend_zar,
  (SELECT COALESCE(SUM(r.cost_zar), 0) FROM ai_runs r
     WHERE r.project_id = projects.id AND r.task_name = '${BRIEF_DRAFT_TASK}') AS brief_cost_zar`;
const DOCUMENT_COLUMNS = "id, project_id, name, size_bytes, phase_key, client_visible, created_at, file_location, version_number";
const TASK_COLUMNS = "id, project_id, step_item_id, phase_key, title, due_date, done, output_document_id";

async function withDocuments(db: Db, workspaceId: string, rows: ProjectRow[]): Promise<Project[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const docs = await db.query<DocumentRow>(
    `SELECT ${DOCUMENT_COLUMNS} FROM documents
     WHERE workspace_id = $1 AND project_id = ANY($2::uuid[])
     ORDER BY created_at DESC, id`,
    [workspaceId, ids]
  );
  const tasks = await db.query<TaskRow>(
    `SELECT ${TASK_COLUMNS} FROM project_tasks
     WHERE workspace_id = $1 AND project_id = ANY($2::uuid[])
     ORDER BY due_date NULLS LAST, created_at, id`,
    [workspaceId, ids]
  );
  return rows.map((row) =>
    toProject(
      row,
      docs.filter((d) => d.project_id === row.id).map(toDocument),
      tasks.filter((t) => t.project_id === row.id).map(toTask)
    )
  );
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
      const docs = m.documents.map((d) => ({ ...d, fileType: fileType(d.name), location: d.storageKey ?? "" }));
      // A stored file starts its history as version 1.
      await db.query(
        `WITH p AS (
           UPDATE projects SET ${TOUCH} WHERE ${where} RETURNING id, workspace_id
         ), d AS (
           INSERT INTO documents (id, project_id, workspace_id, name, file_type, file_location, size_bytes,
             client_visible, phase_key, created_at)
           SELECT d."id", p.id, p.workspace_id, d."name", d."fileType", d."location", d."sizeBytes", d."clientVisible",
             d."phaseKey", d."uploadedAt"
           FROM p, jsonb_to_recordset($3::jsonb) AS d(
             "id" uuid, "name" text, "fileType" text, "location" text, "sizeBytes" bigint, "clientVisible" boolean,
             "phaseKey" text, "uploadedAt" timestamptz)
           ON CONFLICT (id) DO NOTHING
           RETURNING id, workspace_id, name, file_location, size_bytes
         )
         INSERT INTO document_versions (document_id, workspace_id, version_number, file_location, trigger_event, name, size_bytes)
         SELECT id, workspace_id, 1, file_location, 'upload', name, size_bytes FROM d WHERE file_location <> ''`,
        [workspaceId, slug, JSON.stringify(docs)]
      );
      break;
    }
    case "replaceDocumentFile": {
      const rows = await db.query(
        `WITH p AS (
           UPDATE projects SET ${TOUCH} WHERE ${where} RETURNING id
         ), d AS (
           UPDATE documents SET file_location = $4, name = $5, size_bytes = $6, file_type = $7,
             version_number = documents.version_number + 1, updated_at = NOW()
           FROM p WHERE documents.project_id = p.id AND documents.workspace_id = $1 AND documents.id = $3
           RETURNING documents.id, documents.workspace_id, documents.version_number, documents.file_location,
             documents.name, documents.size_bytes
         )
         INSERT INTO document_versions (document_id, workspace_id, version_number, file_location, trigger_event, name, size_bytes)
         SELECT id, workspace_id, version_number, file_location, 'upload', name, size_bytes FROM d
         RETURNING id`,
        [workspaceId, slug, m.documentId, m.storageKey, m.name, m.sizeBytes, fileType(m.name)]
      );
      if (!rows.length) throw new MutationError("No such document");
      break;
    }
    case "restoreDocumentVersion": {
      // Restoring adds a new version with the old content, so nothing in the history is lost.
      const rows = await db.query(
        `WITH p AS (
           UPDATE projects SET ${TOUCH} WHERE ${where} RETURNING id
         ), v AS (
           SELECT dv.document_id, dv.file_location, dv.name, dv.size_bytes
           FROM document_versions dv JOIN documents doc ON doc.id = dv.document_id JOIN p ON doc.project_id = p.id
           WHERE dv.workspace_id = $1 AND dv.document_id = $3 AND dv.version_number = $4
         ), d AS (
           UPDATE documents SET file_location = v.file_location, name = COALESCE(v.name, documents.name),
             size_bytes = v.size_bytes, version_number = documents.version_number + 1, updated_at = NOW()
           FROM v WHERE documents.id = v.document_id
           RETURNING documents.id, documents.workspace_id, documents.version_number, documents.file_location,
             documents.name, documents.size_bytes
         )
         INSERT INTO document_versions (document_id, workspace_id, version_number, file_location, trigger_event, name, size_bytes, notes)
         SELECT id, workspace_id, version_number, file_location, 'restore', name, size_bytes, $5 FROM d
         RETURNING id`,
        [workspaceId, slug, m.documentId, m.version, `Restored version ${m.version}`]
      );
      if (!rows.length) throw new MutationError("No such version");
      break;
    }
    case "restoreBrief": {
      // The brief as it is now is kept as a snapshot first, so a restore can itself be undone.
      const rows = await db.query(
        `WITH s AS (
           SELECT s.brief, s.brief_ai_fields, s.project_id FROM project_snapshots s
           JOIN projects p ON p.id = s.project_id
           WHERE s.id = $3 AND s.workspace_id = $1 AND p.workspace_id = $1 AND p.slug = $2
         ), keep AS (
           INSERT INTO project_snapshots (workspace_id, project_id, phase_key, trigger_event, brief, brief_ai_fields, documents)
           SELECT p.workspace_id, p.id, p.current_phase_key, 'before_restore', p.brief, p.brief_ai_fields, '[]'
           FROM projects p JOIN s ON s.project_id = p.id
         )
         UPDATE projects SET brief = s.brief, brief_ai_fields = s.brief_ai_fields, ${TOUCH}
         FROM s WHERE projects.id = s.project_id
         RETURNING projects.id`,
        [workspaceId, slug, m.snapshotId]
      );
      if (!rows.length) throw new MutationError("No such snapshot");
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
      // Guarded on the phase still being open and its essentials still ticked, checked in the
      // same statement, so neither a second completion nor an untick made meanwhile slips through.
      const essentials = Object.fromEntries(
        (workflow.phases.find((ph) => ph.key === m.phaseKey)?.checklist ?? []).filter((i) => i.essential).map((i) => [i.id, true])
      );
      // The same statement snapshots the brief and every document's version, so a phase is never
      // completed without its snapshot.
      await db.query(
        `WITH done AS (
           UPDATE projects SET completed_phases = $4, current_phase_key = $5, status = $6, ${TOUCH}
           WHERE ${where} AND current_phase_key = $3 AND status <> 'complete' AND checks @> $7::jsonb
           RETURNING id, workspace_id, brief, brief_ai_fields
         )
         INSERT INTO project_snapshots (workspace_id, project_id, phase_key, trigger_event, brief, brief_ai_fields, documents)
         SELECT done.workspace_id, done.id, $3, 'phase_complete', done.brief, done.brief_ai_fields,
           COALESCE((SELECT jsonb_agg(jsonb_build_object('id', d.id, 'version', d.version_number) ORDER BY d.created_at, d.id)
                     FROM documents d WHERE d.project_id = done.id), '[]'::jsonb)
         FROM done`,
        [workspaceId, slug, m.phaseKey, next.completedPhases, next.currentPhase, next.status, JSON.stringify(essentials)]
      );
      break;
    }
    case "addTask": {
      if (!workflow.phases.some((ph) => ph.key === m.phaseKey)) {
        throw new MutationError(`Unknown phase '${m.phaseKey}'`);
      }
      await db.query(
        `WITH p AS (UPDATE projects SET ${TOUCH} WHERE ${where} RETURNING id, workspace_id)
         INSERT INTO project_tasks (id, workspace_id, project_id, phase_key, title, due_date)
         SELECT $3, p.workspace_id, p.id, $4, $5, $6::date FROM p
         ON CONFLICT (id) DO NOTHING`,
        [workspaceId, slug, m.id, m.phaseKey, m.title, m.due ?? null]
      );
      break;
    }
    case "updateTask": {
      // Each field is left alone unless the change names it; a null clears the date or the output.
      const rows = await db.query(
        `WITH p AS (UPDATE projects SET ${TOUCH} WHERE ${where} RETURNING id)
         UPDATE project_tasks t SET
           title = COALESCE($4, t.title),
           due_date = CASE WHEN $5::boolean THEN $6::date ELSE t.due_date END,
           done = COALESCE($7, t.done),
           output_document_id = CASE WHEN $8::boolean THEN $9::uuid ELSE t.output_document_id END,
           updated_at = NOW()
         FROM p
         WHERE t.id = $3 AND t.project_id = p.id AND t.workspace_id = $1
         RETURNING t.id`,
        [
          workspaceId,
          slug,
          m.taskId,
          m.title ?? null,
          m.due !== undefined,
          m.due ?? null,
          m.done ?? null,
          m.outputDocumentId !== undefined,
          m.outputDocumentId ?? null,
        ]
      );
      if (!rows.length) throw new MutationError("No such task");
      break;
    }
    case "deleteTask": {
      // Only a task of their own can be deleted; a workflow step is the workflow's.
      await db.query(
        `WITH p AS (UPDATE projects SET ${TOUCH} WHERE ${where} RETURNING id)
         DELETE FROM project_tasks t USING p
         WHERE t.id = $3 AND t.project_id = p.id AND t.workspace_id = $1 AND t.step_item_id IS NULL`,
        [workspaceId, slug, m.taskId]
      );
      break;
    }
    case "setStepDue":
    case "setStepOutput": {
      const phase = workflow.phases.find((ph) => ph.checklist.some((i) => i.id === m.itemId));
      if (!phase) throw new MutationError(`Unknown checklist item '${m.itemId}'`);
      const due = m.type === "setStepDue" ? m.due : null;
      const output = m.type === "setStepOutput" ? m.documentId : null;
      // One row per step: moving its date twice changes the same row.
      await db.query(
        `WITH p AS (UPDATE projects SET ${TOUCH} WHERE ${where} RETURNING id, workspace_id)
         INSERT INTO project_tasks (workspace_id, project_id, step_item_id, phase_key, due_date, output_document_id)
         SELECT p.workspace_id, p.id, $3, $4, $5::date, $6::uuid FROM p
         ON CONFLICT (project_id, step_item_id) WHERE step_item_id IS NOT NULL DO UPDATE SET
           due_date = CASE WHEN $7::boolean THEN EXCLUDED.due_date ELSE project_tasks.due_date END,
           output_document_id = CASE WHEN $8::boolean THEN EXCLUDED.output_document_id ELSE project_tasks.output_document_id END,
           updated_at = NOW()`,
        [workspaceId, slug, m.itemId, phase.key, due, output, m.type === "setStepDue", m.type === "setStepOutput"]
      );
      break;
    }
  }

  return getProject(db, workspaceId, slug);
}

/** The project's database id, for records that point at it (such as the AI call log). */
export async function projectDbId(db: Db, workspaceId: string, slug: string): Promise<string | null> {
  const rows = await db.query<{ id: string }>("SELECT id FROM projects WHERE workspace_id = $1 AND slug = $2", [workspaceId, slug]);
  return rows[0]?.id ?? null;
}

export interface SnapshotSummary {
  id: string;
  phaseKey: string;
  /** "phase_complete", or "before_restore" for the brief kept when an older one was restored. */
  trigger: string;
  createdAt: string;
  brief: Record<string, string>;
  briefAiFields: string[];
  documents: { id: string; version: number }[];
}

export interface DocumentVersion {
  documentId: string;
  version: number;
  name: string;
  sizeBytes: number;
  trigger: string;
  notes: string | null;
  createdAt: string;
}

/** The project's snapshots (newest first) and every stored version of its files, or null if there is no such project. */
export async function listVersions(
  db: Db,
  workspaceId: string,
  slug: string
): Promise<{ snapshots: SnapshotSummary[]; documentVersions: DocumentVersion[] } | null> {
  const id = await projectDbId(db, workspaceId, slug);
  if (!id) return null;
  const snaps = await db.query<{
    id: string;
    phase_key: string;
    trigger_event: string;
    created_at: Date | string;
    brief: Record<string, string>;
    brief_ai_fields: string[];
    documents: { id: string; version: number }[];
  }>(
    `SELECT id, phase_key, trigger_event, created_at, brief, brief_ai_fields, documents FROM project_snapshots
     WHERE workspace_id = $1 AND project_id = $2 ORDER BY created_at DESC, id`,
    [workspaceId, id]
  );
  const versions = await db.query<{
    document_id: string;
    version_number: number;
    name: string | null;
    size_bytes: string | number;
    trigger_event: string;
    notes: string | null;
    created_at: Date | string;
  }>(
    `SELECT dv.document_id, dv.version_number, dv.name, dv.size_bytes, dv.trigger_event, dv.notes, dv.created_at
     FROM document_versions dv JOIN documents d ON d.id = dv.document_id
     WHERE dv.workspace_id = $1 AND d.project_id = $2 ORDER BY dv.document_id, dv.version_number DESC`,
    [workspaceId, id]
  );
  return {
    snapshots: snaps.map((r) => ({
      id: r.id,
      phaseKey: r.phase_key,
      trigger: r.trigger_event,
      createdAt: iso(r.created_at),
      brief: r.brief,
      briefAiFields: r.brief_ai_fields,
      documents: r.documents,
    })),
    documentVersions: versions.map((r) => ({
      documentId: r.document_id,
      version: r.version_number,
      name: r.name ?? "",
      sizeBytes: Number(r.size_bytes),
      trigger: r.trigger_event,
      notes: r.notes,
      createdAt: iso(r.created_at),
    })),
  };
}

/** Where a document's file (or one of its versions) is stored, if it is stored. */
export async function documentFile(
  db: Db,
  workspaceId: string,
  slug: string,
  documentId: string,
  version?: number
): Promise<{ pathname: string; name: string } | null> {
  const rows = await db.query<{ file_location: string; name: string | null }>(
    version == null
      ? `SELECT d.file_location, d.name FROM documents d JOIN projects p ON p.id = d.project_id
         WHERE d.workspace_id = $1 AND p.slug = $2 AND d.id = $3`
      : `SELECT dv.file_location, dv.name FROM document_versions dv
         JOIN documents d ON d.id = dv.document_id JOIN projects p ON p.id = d.project_id
         WHERE dv.workspace_id = $1 AND p.slug = $2 AND d.id = $3 AND dv.version_number = $4`,
    version == null ? [workspaceId, slug, documentId] : [workspaceId, slug, documentId, version]
  );
  const row = rows[0];
  return row?.file_location ? { pathname: row.file_location, name: row.name ?? "file" } : null;
}
