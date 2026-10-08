import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { Db } from "@/lib/db";
import { getDraft } from "./store";
import { publishErrors } from "./editor-model";
import {
  workflowEditSummary,
  type BuildInput,
  type BuildResult,
  type BuildRecord,
  type BuilderSettings,
} from "./builder-model";
import type { WorkflowDefinition } from "./schema";
export class BuilderError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export async function builderSettings(
  db: Db,
  workspaceId: string,
): Promise<BuilderSettings> {
  const [r] = await db.query<{
    enabled: boolean;
    audience: "admin" | "owners";
    monthly_cap_zar: string;
    spent: string;
  }>(
    `SELECT COALESCE(s.enabled,FALSE) enabled,COALESCE(s.audience,'admin') audience,COALESCE(s.monthly_cap_zar,150) monthly_cap_zar,(SELECT COALESCE(SUM(cost_zar),0) FROM ai_runs WHERE workspace_id=$1 AND task_name='workflow_builder' AND created_at>=date_trunc('month',NOW() AT TIME ZONE 'Africa/Johannesburg') AT TIME ZONE 'Africa/Johannesburg') spent FROM (SELECT $1::uuid id) w LEFT JOIN workflow_builder_settings s ON s.workspace_id=w.id`,
    [workspaceId],
  );
  return {
    enabled: r.enabled,
    audience: r.audience,
    monthlyCapZar: Number(r.monthly_cap_zar),
    spentZar: Number(r.spent),
  };
}
export async function saveBuilderSettings(
  db: Db,
  workspaceId: string,
  userId: string,
  input: {
    enabled: boolean;
    audience: "admin" | "owners";
    monthlyCapZar: number;
  },
) {
  if (
    !Number.isFinite(input.monthlyCapZar) ||
    input.monthlyCapZar < 0 ||
    input.monthlyCapZar > 10000
  )
    throw new BuilderError("Choose a monthly cap between R0 and R10,000.");
  await db.query(
    `INSERT INTO workflow_builder_settings(workspace_id,enabled,audience,monthly_cap_zar,updated_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(workspace_id) DO UPDATE SET enabled=$2,audience=$3,monthly_cap_zar=$4,updated_by=$5,updated_at=NOW()`,
    [workspaceId, input.enabled, input.audience, input.monthlyCapZar, userId],
  );
  return builderSettings(db, workspaceId);
}
export async function assertBuilderBudget(
  db: Db,
  workspaceId: string,
  isAdmin: boolean,
  estimatedZar = 0,
) {
  const s = await builderSettings(db, workspaceId);
  if (!s.enabled || (s.audience === "admin" && !isAdmin))
    throw new BuilderError(
      "The workflow builder is not enabled for your practice yet.",
      403,
    );
  if (
    s.monthlyCapZar <= s.spentZar ||
    s.spentZar + estimatedZar > s.monthlyCapZar
  )
    throw new BuilderError(
      "This practice's monthly workflow-building budget is used up or too small for the next attempt. The platform Admin can adjust the cap.",
      429,
    );
  return s;
}
type Row = {
  id: string;
  mode: BuildRecord["mode"];
  input: BuildInput;
  status: BuildRecord["status"];
  result: BuildResult | null;
  error: string | null;
  accepted_workflow_id: string | null;
  created_at: string | Date;
  cost_zar: string;
};
const record = (r: Row): BuildRecord => ({
  id: r.id,
  mode: r.mode,
  input: r.input,
  status: r.status,
  result: r.result,
  error: r.error,
  acceptedWorkflowId: r.accepted_workflow_id,
  createdAt: new Date(r.created_at).toISOString(),
  costZar: Number(r.cost_zar),
});
async function expire(db: Db, ws: string) {
  await db.query(
    "UPDATE workflow_builds SET status='failed',error='This build was interrupted. Start a new request; any known charges remain in the cost history.',finished_at=NOW() WHERE workspace_id=$1 AND status='running' AND created_at<NOW()-INTERVAL '10 minutes'",
    [ws],
  );
}
export async function getBuild(db: Db, ws: string, id: string) {
  const [r] = await db.query<Row>(
    `SELECT b.*,(SELECT COALESCE(SUM(cost_zar),0) FROM ai_runs WHERE workspace_id=b.workspace_id AND task_name='workflow_builder' AND task_ref=b.id::text) cost_zar FROM workflow_builds b WHERE workspace_id=$1 AND id=$2`,
    [ws, id],
  );
  return r ? record(r) : null;
}
export async function listBuilds(db: Db, ws: string) {
  await expire(db, ws);
  const rows = await db.query<Row>(
    `SELECT b.*,(SELECT COALESCE(SUM(cost_zar),0) FROM ai_runs WHERE workspace_id=b.workspace_id AND task_name='workflow_builder' AND task_ref=b.id::text) cost_zar FROM workflow_builds b WHERE workspace_id=$1 ORDER BY created_at DESC,id DESC LIMIT 30`,
    [ws],
  );
  return rows.map(record);
}
export async function startBuild(
  db: Db,
  ws: string,
  user: string,
  id: string,
  mode: BuildRecord["mode"],
  input: BuildInput,
  isAdmin: boolean,
) {
  await expire(db, ws);
  const existing = await getBuild(db, ws, id);
  if (existing) {
    if (existing.mode !== mode || !isDeepStrictEqual(existing.input, input))
      throw new BuilderError(
        "This request ID was already used for a different description.",
        409,
      );
    return { record: existing, started: false };
  }
  await assertBuilderBudget(db, ws, isAdmin);
  try {
    await db.query(
      "INSERT INTO workflow_builds(id,workspace_id,user_id,mode,input) VALUES($1,$2,$3,$4,$5::jsonb)",
      [id, ws, user, mode, JSON.stringify(input)],
    );
  } catch (e) {
    if ((e as { code?: string }).code === "23505") {
      const same = await getBuild(db, ws, id);
      if (same && same.mode === mode && isDeepStrictEqual(same.input, input))
        return { record: same, started: false };
      throw new BuilderError(
        "Another build is already running for this practice. Wait for it to finish before starting again.",
        409,
      );
    }
    throw e;
  }
  return { record: (await getBuild(db, ws, id))!, started: true };
}
export async function assertBuildActive(db: Db, ws: string, id: string) {
  const build = await getBuild(db, ws, id);
  if (build?.status !== "running")
    throw new BuilderError("This build is no longer running.", 409);
}
export async function finishBuild(
  db: Db,
  ws: string,
  id: string,
  result: BuildResult | null,
  error?: string,
) {
  const capabilities = result?.missingCapabilities ?? [];
  await db.query(
    `WITH b AS (UPDATE workflow_builds SET status=$3,result=$4::jsonb,error=$5,finished_at=NOW() WHERE workspace_id=$1 AND id=$2 AND status='running' RETURNING id,workspace_id) INSERT INTO workflow_capability_requests(id,workspace_id,build_id,capability) SELECT x.id,b.workspace_id,b.id,x.capability FROM b CROSS JOIN jsonb_to_recordset($6::jsonb) AS x(id uuid,capability text)`,
    [
      ws,
      id,
      result ? "ready" : "failed",
      result ? JSON.stringify(result) : null,
      error ?? null,
      JSON.stringify(
        capabilities.map((capability) => ({ id: randomUUID(), capability })),
      ),
    ],
  );
  return (await getBuild(db, ws, id))!;
}
export async function acceptBuild(
  db: Db,
  ws: string,
  user: string,
  id: string,
) {
  const build = await getBuild(db, ws, id);
  if (!build) throw new BuilderError("Build not found", 404);
  if (build.acceptedWorkflowId)
    return (await getDraft(db, ws, build.acceptedWorkflowId))!;
  if (build.status !== "ready" || !build.result?.workflow)
    throw new BuilderError(
      "Only a valid generated workflow can be opened in the editor.",
    );
  const source = build.result.workflow,
    checked = publishErrors(source);
  if (checked.errors.length)
    throw new BuilderError(
      "This draft needs rebuilding before it can be edited.",
    );
  const workflowId = `wf-${randomUUID()}`,
    definition = { ...source, id: workflowId, version: 1 };
  const [r] = await db.query<{ workflow_id: string }>(
    `WITH b AS (SELECT id,accepted_workflow_id FROM workflow_builds WHERE workspace_id=$1 AND id=$2 AND status='ready' FOR UPDATE),w AS (INSERT INTO workflows(id,workspace_id,name,description,status) SELECT $3,$1,$4,$5,'draft' FROM b WHERE accepted_workflow_id IS NULL RETURNING id),d AS (INSERT INTO workflow_drafts(workflow_id,workspace_id,definition,updated_by) SELECT id,$1,$6::jsonb,$7 FROM w RETURNING workflow_id),a AS (UPDATE workflow_builds SET accepted_workflow_id=d.workflow_id FROM d WHERE workflow_builds.id=$2 AND workspace_id=$1 RETURNING accepted_workflow_id) SELECT accepted_workflow_id workflow_id FROM a UNION ALL SELECT accepted_workflow_id FROM b WHERE accepted_workflow_id IS NOT NULL`,
    [
      ws,
      id,
      workflowId,
      definition.name,
      definition.description,
      JSON.stringify(definition),
      user,
    ],
  );
  const accepted =
    r?.workflow_id ?? (await getBuild(db, ws, id))?.acceptedWorkflowId;
  if (!accepted)
    throw new BuilderError("The draft could not be opened. Retry.", 409);
  return (await getDraft(db, ws, accepted))!;
}
export async function builderEditMetrics(db: Db, ws?: string) {
  const rows = await db.query<{
    id: string;
    name: string;
    baseline: WorkflowDefinition;
    published: WorkflowDefinition;
  }>(
    `SELECT b.id,w.name,b.result->'workflow' baseline,v.definition published FROM workflow_builds b JOIN workflows w ON w.id=b.accepted_workflow_id JOIN workflow_versions v ON v.workflow_id=w.id AND v.version_number=1 WHERE ($1::uuid IS NULL OR b.workspace_id=$1) AND b.status='ready' ORDER BY b.created_at DESC LIMIT 100`,
    [ws ?? null],
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    summary: workflowEditSummary(r.baseline, r.published),
  }));
}
export async function capabilityBacklog(db: Db) {
  return db.query<{
    id: string;
    capability: string;
    status: string;
    workspace_name: string;
    workflow_name: string | null;
    created_at: string;
  }>(
    `SELECT c.id,c.capability,c.status,w.name workspace_name,b.result->'workflow'->>'name' workflow_name,c.created_at FROM workflow_capability_requests c JOIN workspaces w ON w.id=c.workspace_id JOIN workflow_builds b ON b.id=c.build_id ORDER BY c.created_at DESC LIMIT 200`,
  );
}
