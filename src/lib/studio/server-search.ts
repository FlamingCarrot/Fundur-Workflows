import type { Db } from "@/lib/db";
import type { WorkspaceRole } from "@/lib/auth/permissions";
import {
  getForm,
  getWorkflow,
  label,
  listBuiltInWorkflowVersions,
  phaseWithForm,
} from "@/lib/workflow";
import type { WorkflowDefinition } from "@/lib/workflow/schema";
import { KIND_ORDER, type ResultKind, type SearchResult } from "./search";
import { starterRegulations } from "@/lib/regulations/model";
export function searchTerms(raw: string) {
  return (
    raw
      .trim()
      .slice(0, 120)
      .match(/[\p{L}\p{N}]+/gu) ?? []
  )
    .slice(0, 10)
    .map((word) => `'${word}':*`)
    .join(" & ");
}
interface Row {
  kind: ResultKind;
  key: string;
  title: string;
  body: string;
  slug: string;
  project_name: string;
  client_name: string;
  phase_key: string;
  form_key: string | null;
  field_key: string | null;
  definition: WorkflowDefinition;
  score: number;
}
/** Saved metadata/text only. Binary document contents and unrelated practices never enter this query. */
export async function searchSavedWork(
  db: Db,
  ctx: { workspaceId: string; userId: string; workspaceRole: WorkspaceRole },
  raw: string,
) {
  const query = raw.trim().slice(0, 120),
    terms = searchTerms(query);
  if (query.length < 2 || !terms || ctx.workspaceRole === "client") return [];
  const builtins = Object.fromEntries(
    listBuiltInWorkflowVersions().map((w) => [`${w.id}:${w.version}`, w]),
  );
  const rows = await db.query<Row>(
    `WITH q AS (SELECT to_tsquery('english',$4) term), scoped AS NOT MATERIALIZED (SELECT p.*,COALESCE(p.workflow_definition,$6::jsonb->(p.workflow_id||':'||p.workflow_version)) definition FROM projects p WHERE p.workspace_id=$1 AND ($3::boolean OR EXISTS(SELECT 1 FROM project_members m WHERE m.workspace_id=p.workspace_id AND m.project_id=p.id AND m.user_id=$2))),
 hits AS (
 SELECT 'project' kind,p.slug key,p.name title,COALESCE(p.client_name,'') body,p.slug,p.name project_name,COALESCE(p.client_name,'') client_name,p.current_phase_key phase_key,NULL::text form_key,NULL::text field_key,p.definition,100+ts_rank(to_tsvector('english',p.name),q.term) score FROM scoped p CROSS JOIN q WHERE to_tsvector('english',p.name)@@q.term OR p.name ILIKE $5 ESCAPE '\\'
 UNION ALL SELECT 'client',p.slug||'-client',COALESCE(p.client_name,''),p.name,p.slug,p.name,COALESCE(p.client_name,''),p.current_phase_key,NULL,NULL,p.definition,90+ts_rank(to_tsvector('english',COALESCE(p.client_name,'')),q.term) FROM scoped p CROSS JOIN q WHERE to_tsvector('english',COALESCE(p.client_name,''))@@q.term OR p.client_name ILIKE $5 ESCAPE '\\'
 UNION ALL SELECT 'document',p.slug||'-'||d.id::text,d.name,'',p.slug,p.name,COALESCE(p.client_name,''),COALESCE(d.phase_key,p.current_phase_key),NULL,NULL,p.definition,80+ts_rank(to_tsvector('english',d.name),q.term) FROM scoped p JOIN documents d ON d.workspace_id=p.workspace_id AND d.project_id=p.id CROSS JOIN q WHERE to_tsvector('english',d.name)@@q.term OR d.name ILIKE $5 ESCAPE '\\'
 UNION ALL SELECT 'task',p.slug||'-'||t.id::text,t.title,'',p.slug,p.name,COALESCE(p.client_name,''),t.phase_key,NULL,NULL,p.definition,70+ts_rank(to_tsvector('english',t.title),q.term) FROM scoped p JOIN project_tasks t ON t.workspace_id=p.workspace_id AND t.project_id=p.id CROSS JOIN q WHERE t.step_item_id IS NULL AND (to_tsvector('english',t.title)@@q.term OR t.title ILIKE $5 ESCAPE '\\')
 UNION ALL SELECT 'task',p.slug||'-'||(step->>'id'),step->>'text','',p.slug,p.name,COALESCE(p.client_name,''),phase->>'key',NULL,NULL,p.definition,70+ts_rank(to_tsvector('english',step->>'text'),q.term) FROM scoped p CROSS JOIN LATERAL jsonb_array_elements(p.definition->'phases') phase CROSS JOIN LATERAL jsonb_array_elements(phase->'checklist') step CROSS JOIN q WHERE to_tsvector('english',step->>'text')@@q.term OR step->>'text' ILIKE $5 ESCAPE '\\'
 UNION ALL SELECT 'task',p.slug||'-'||requirement.key,requirement.value->>'title','',p.slug,p.name,COALESCE(p.client_name,''),phase->>'key',NULL,NULL,p.definition,70+ts_rank(to_tsvector('english',requirement.value->>'title'),q.term) FROM scoped p CROSS JOIN LATERAL jsonb_each(COALESCE(p.regulations,$7::jsonb)) requirement CROSS JOIN LATERAL jsonb_array_elements(p.definition->'phases') phase CROSS JOIN q WHERE phase->'modules'?'regulatory_checklist' AND (to_tsvector('english',requirement.value->>'title')@@q.term OR requirement.value->>'title' ILIKE $5 ESCAPE '\\')
 UNION ALL SELECT 'brief',p.slug||'-'||f.key,f.key,f.value,p.slug,p.name,COALESCE(p.client_name,''),p.current_phase_key,'brief',f.key,p.definition,50+ts_rank(to_tsvector('english',f.value),q.term) FROM scoped p CROSS JOIN LATERAL jsonb_each_text(p.brief) f CROSS JOIN q WHERE jsonb_to_tsvector('english',p.brief,'["string"]')@@q.term AND to_tsvector('english',f.value)@@q.term
 UNION ALL SELECT 'form',p.slug||'-'||form.key||'-'||f.key,f.key,f.value,p.slug,p.name,COALESCE(p.client_name,''),p.current_phase_key,form.key,f.key,p.definition,50+ts_rank(to_tsvector('english',f.value),q.term) FROM scoped p CROSS JOIN LATERAL jsonb_each(p.form_values) form CROSS JOIN LATERAL jsonb_each_text(form.value) f CROSS JOIN q WHERE jsonb_to_tsvector('english',p.form_values,'["string"]')@@q.term AND to_tsvector('english',f.value)@@q.term
 ),ranked AS (SELECT *,row_number() OVER(PARTITION BY kind ORDER BY score DESC,title,key) position FROM hits) SELECT * FROM ranked WHERE position<=5 ORDER BY score DESC,title,key`,
    [
      ctx.workspaceId,
      ctx.userId,
      ctx.workspaceRole !== "collaborator",
      terms,
      `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`,
      JSON.stringify(builtins),
      JSON.stringify(starterRegulations()),
    ],
  );
  const results: SearchResult[] = rows.flatMap((r) => {
    if (!r.definition) return [];
    const ref = {
      workflowId: r.definition.id,
      workflowVersion: r.definition.version,
      workflowDefinition: r.definition,
    };
    let workflow: WorkflowDefinition;
    try {
      workflow = getWorkflow(ref);
    } catch {
      return [];
    }
    const phase = workflow.phases.find((p) => p.key === r.phase_key),
      base = `/projects/${encodeURIComponent(r.slug)}`;
    let title = r.title,
      context = `${r.project_name}${phase ? ` · ${phase.name}` : ""}`,
      href = base;
    if (r.kind === "project")
      context = `${r.client_name}${phase ? ` · ${phase.name}` : ""}`;
    if (r.kind === "client") context = r.project_name;
    if (r.kind === "document") href = `${base}/documents`;
    if (r.kind === "task")
      href = `${base}/phases/${encodeURIComponent(r.phase_key)}`;
    if (r.kind === "brief" || r.kind === "form") {
      const form = getForm(ref, r.form_key!),
        field = form?.fields.find((f) => f.key === r.field_key);
      if (!field || !phaseWithForm(ref, r.form_key!)) return [];
      title = `${field.label} · ${r.kind === "brief" ? r.project_name : label(ref, r.form_key!, r.form_key!.startsWith("notes:") ? "Phase notes" : r.form_key!)}`;
      const first =
          query.toLowerCase().match(/[\p{L}\p{N}]+/u)?.[0] ??
          query.toLowerCase(),
        i = r.body.toLowerCase().indexOf(first),
        start = Math.max(0, i - 24);
      context = `${r.project_name} · ${start ? "…" : ""}${r.body.slice(start, start + 100).replace(/\s+/g, " ")}${r.body.length > start + 100 ? "…" : ""}`;
      href =
        r.kind === "brief"
          ? `${base}/brief`
          : `${base}/forms/${encodeURIComponent(r.form_key!)}`;
    }
    return [
      {
        kind: r.kind,
        id: r.key,
        title,
        context,
        href,
        projectId: r.slug,
        score: Number(r.score),
      },
    ];
  });
  return KIND_ORDER.map((kind) => ({
    kind,
    results: results.filter((r) => r.kind === kind),
  })).filter((g) => g.results.length);
}
