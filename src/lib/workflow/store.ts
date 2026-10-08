import { randomUUID } from "node:crypto";
import type { Db } from "@/lib/db";
import { getWorkflow, listWorkflows } from "./index";
import type { WorkflowDefinition } from "./schema";
import { publishErrors, type WorkflowDraft } from "./editor-model";
export class WorkflowEditError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
const draftRow = (r: {
  workflow_id: string;
  definition: WorkflowDefinition;
  revision: number;
  published_version: number;
  updated_at: Date | string;
}): WorkflowDraft => ({
  id: r.workflow_id,
  definition: r.definition,
  revision: r.revision,
  publishedVersion: r.published_version,
  updatedAt: new Date(r.updated_at).toISOString(),
  errors: publishErrors(r.definition).errors,
});
export async function listPublishedWorkflows(db: Db, workspaceId: string) {
  const rows = await db.query<{ definition: WorkflowDefinition }>(
    `SELECT v.definition FROM workflow_versions v JOIN workflows w ON w.id=v.workflow_id WHERE w.workspace_id=$1 ORDER BY w.created_at,v.version_number`,
    [workspaceId],
  );
  return [...listWorkflows(), ...rows.map((r) => r.definition)];
}
export async function publishedWorkflow(
  db: Db,
  workspaceId: string,
  id: string,
  version?: number,
) {
  const built = listWorkflows().find((w) => w.id === id);
  if (built) {
    try {
      return getWorkflow({ workflowId: id, workflowVersion: version });
    } catch {
      return null;
    }
  }
  const [r] = await db.query<{ definition: WorkflowDefinition }>(
    `SELECT v.definition FROM workflow_versions v JOIN workflows w ON w.id=v.workflow_id WHERE w.workspace_id=$1 AND w.id=$2 AND ($3::int IS NULL OR v.version_number=$3) ORDER BY v.version_number DESC LIMIT 1`,
    [workspaceId, id, version ?? null],
  );
  return r?.definition ?? null;
}
export async function listDrafts(db: Db, workspaceId: string) {
  const rows = await db.query<Parameters<typeof draftRow>[0]>(
    "SELECT * FROM workflow_drafts WHERE workspace_id=$1 ORDER BY updated_at DESC,workflow_id",
    [workspaceId],
  );
  return rows.map(draftRow);
}
export async function getDraft(db: Db, workspaceId: string, id: string) {
  const [r] = await db.query<Parameters<typeof draftRow>[0]>(
    "SELECT * FROM workflow_drafts WHERE workspace_id=$1 AND workflow_id=$2",
    [workspaceId, id],
  );
  return r ? draftRow(r) : null;
}
export async function createDraft(
  db: Db,
  workspaceId: string,
  userId: string,
  source: WorkflowDefinition,
) {
  const id = `wf-${randomUUID()}`;
  const definition = {
    ...source,
    id,
    version: 1,
    name: `${source.name} — practice copy`,
  };
  await db.query(
    `WITH w AS (INSERT INTO workflows(id,workspace_id,name,description,status) VALUES($2,$1,$3,$4,'draft') RETURNING id) INSERT INTO workflow_drafts(workflow_id,workspace_id,definition,updated_by) SELECT id,$1,$5::jsonb,$6 FROM w`,
    [
      workspaceId,
      id,
      definition.name,
      definition.description,
      JSON.stringify(definition),
      userId,
    ],
  );
  return (await getDraft(db, workspaceId, id))!;
}
export async function saveDraft(
  db: Db,
  workspaceId: string,
  userId: string,
  id: string,
  revision: number,
  raw: WorkflowDefinition,
) {
  if (JSON.stringify(raw).length > 100_000)
    throw new WorkflowEditError("Keep the workflow under 100 KB.");
  const rows = await db.query(
    `UPDATE workflow_drafts SET definition=jsonb_set(jsonb_set($4::jsonb,'{id}',to_jsonb(workflow_id)),'{version}',to_jsonb(published_version+1)),revision=revision+1,updated_by=$5,updated_at=NOW() WHERE workspace_id=$1 AND workflow_id=$2 AND revision=$3 RETURNING workflow_id`,
    [workspaceId, id, revision, JSON.stringify(raw), userId],
  );
  if (!rows.length)
    throw new WorkflowEditError(
      "This workflow changed in another tab. Reload the latest draft before saving.",
      409,
    );
  return (await getDraft(db, workspaceId, id))!;
}
export async function publishDraft(
  db: Db,
  workspaceId: string,
  userId: string,
  id: string,
  revision: number,
) {
  const draft = await getDraft(db, workspaceId, id);
  if (!draft) throw new WorkflowEditError("Workflow not found", 404);
  const checked = publishErrors(draft.definition);
  if (checked.errors.length || !checked.workflow)
    throw new WorkflowEditError(checked.errors.join("\n"));
  const definition = {
    ...checked.workflow,
    id,
    version: draft.publishedVersion + 1,
  };
  const rows = await db.query(
    `WITH d AS (UPDATE workflow_drafts SET published_version=published_version+1,definition=jsonb_set($4::jsonb,'{version}',to_jsonb(published_version+2)),revision=revision+1,updated_by=$5,updated_at=NOW() WHERE workspace_id=$1 AND workflow_id=$2 AND revision=$3 RETURNING workflow_id,published_version),v AS (INSERT INTO workflow_versions(workflow_id,version_number,definition) SELECT workflow_id,published_version,$4::jsonb FROM d RETURNING workflow_id),w AS (UPDATE workflows SET name=$6,description=$7,status='published' FROM v WHERE workflows.id=v.workflow_id AND workflows.workspace_id=$1 RETURNING workflows.id) SELECT id FROM w`,
    [
      workspaceId,
      id,
      revision,
      JSON.stringify(definition),
      userId,
      definition.name,
      definition.description,
    ],
  );
  if (!rows.length)
    throw new WorkflowEditError(
      "The draft changed before publication. Reload and review it.",
      409,
    );
  return {
    published: definition,
    draft: (await getDraft(db, workspaceId, id))!,
  };
}
