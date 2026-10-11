import type { Db } from "@/lib/db";
import type { ConceptInput, ConceptGeneration, ConceptResult } from "./schema";
export class ConceptBusyError extends Error {}
export async function expireConcepts(
  db: Db,
  workspaceId: string,
  projectId: string,
) {
  await db.query(
    `UPDATE concept_generations SET status=CASE WHEN jsonb_array_length(results)>0 THEN 'partial' ELSE 'failed' END,error='Generation was interrupted. Saved alternatives remain available; start a new request for more.',updated_at=NOW() WHERE workspace_id=$1 AND project_id=$2 AND status='running' AND created_at<NOW()-INTERVAL '10 minutes'`,
    [workspaceId, projectId],
  );
}
export async function listConcepts(
  db: Db,
  workspaceId: string,
  projectId: string,
): Promise<ConceptGeneration[]> {
  await expireConcepts(db, workspaceId, projectId);
  const rows = await db.query<{
    id: string;
    input: ConceptInput;
    results: ConceptResult[];
    status: ConceptGeneration["status"];
    error: string | null;
    created_at: Date | string;
    cost_zar: number | string;
  }>(
    `SELECT g.*,COALESCE((SELECT SUM(a.cost_zar) FROM ai_runs a WHERE a.workspace_id=g.workspace_id AND a.project_id=g.project_id AND a.task_ref=g.id::text),0) AS cost_zar FROM concept_generations g WHERE workspace_id=$1 AND project_id=$2 ORDER BY created_at DESC,id DESC LIMIT 20`,
    [workspaceId, projectId],
  );
  return rows.map((r) => ({
    id: r.id,
    input: r.input,
    results: r.results,
    status: r.status,
    error: r.error,
    createdAt: new Date(r.created_at).toISOString(),
    costZar: Number(r.cost_zar),
  }));
}
export async function beginConcept(
  db: Db,
  workspaceId: string,
  projectId: string,
  userId: string,
  input: ConceptInput,
  source: unknown,
) {
  await expireConcepts(db, workspaceId, projectId);
  const [existing] = await db.query<{ input: ConceptInput }>(
    "SELECT input FROM concept_generations WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
    [workspaceId, projectId, input.requestId],
  );
  if (existing) {
    if (
      Object.keys(input).some(
        (k) =>
          existing.input[k as keyof ConceptInput] !==
          input[k as keyof ConceptInput],
      )
    )
      throw new ConceptBusyError(
        "This request was already used for different inputs. Start a new request.",
      );
    return false;
  }
  const rows = await db.query(
    `INSERT INTO concept_generations(id,workspace_id,project_id,created_by,input,source,status) SELECT $3,$1,p.id,$4,$5::jsonb,$6::jsonb,'running' FROM projects p WHERE p.workspace_id=$1 AND p.id=$2 ON CONFLICT DO NOTHING RETURNING id`,
    [
      workspaceId,
      projectId,
      input.requestId,
      userId,
      JSON.stringify(input),
      JSON.stringify(source),
    ],
  );
  if (!rows.length)
    throw new ConceptBusyError(
      "A concept request is already running. Its saved alternatives will appear here.",
    );
  return true;
}
export async function appendConcept(
  db: Db,
  workspaceId: string,
  projectId: string,
  id: string,
  result: ConceptResult,
) {
  const rows = await db.query(
    `UPDATE concept_generations SET results=results || $4::jsonb,updated_at=NOW() WHERE workspace_id=$1 AND project_id=$2 AND id=$3 AND status='running' RETURNING id`,
    [workspaceId, projectId, id, JSON.stringify([result])],
  );
  if (!rows.length) throw new Error("Concept request is no longer running.");
}
export async function finishConcept(
  db: Db,
  workspaceId: string,
  projectId: string,
  id: string,
  error?: string,
) {
  await db.query(
    `UPDATE concept_generations SET status=CASE WHEN $4::text IS NULL THEN 'complete' WHEN jsonb_array_length(results)>0 THEN 'partial' ELSE 'failed' END,error=$4,updated_at=NOW() WHERE workspace_id=$1 AND project_id=$2 AND id=$3 AND status='running'`,
    [workspaceId, projectId, id, error ?? null],
  );
}
