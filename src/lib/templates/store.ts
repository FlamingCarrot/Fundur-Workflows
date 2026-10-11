import type { Db } from "@/lib/db";
import {
  templateInput,
  seedSetup,
  type ProjectTemplate,
  type TemplateSummary,
} from "./model";
type Row = {
  id: string;
  name: string;
  data: ProjectTemplate["data"];
  created_at: Date | string;
};
const fromRow = (r: Row): ProjectTemplate => ({
  ...templateInput.parse({ name: r.name, data: r.data }),
  id: r.id,
  createdAt: new Date(r.created_at).toISOString(),
});
export async function listTemplates(
  db: Db,
  workspace: string,
): Promise<TemplateSummary[]> {
  const rows = await db.query<TemplateSummary & { created_at: Date | string }>(
    `SELECT id,name,created_at,data->>'workflowId' AS "workflowId",(data->>'workflowVersion')::integer AS "workflowVersion",jsonb_array_length(data->'items') AS "itemCount",jsonb_array_length(data->'requirements') AS "requirementCount" FROM project_templates WHERE workspace_id=$1 ORDER BY name,id LIMIT 100`,
    [workspace],
  );
  return rows.map(({ created_at, ...r }) => ({
    ...r,
    createdAt: new Date(created_at).toISOString(),
  }));
}
export async function getTemplate(
  db: Db,
  workspace: string,
  id: string,
): Promise<ProjectTemplate | null> {
  const [row] = await db.query<Row>(
    "SELECT id,name,data,created_at FROM project_templates WHERE workspace_id=$1 AND id=$2",
    [workspace, id],
  );
  return row ? fromRow(row) : null;
}
export async function saveTemplate(
  db: Db,
  workspace: string,
  user: string,
  input: unknown,
): Promise<ProjectTemplate> {
  const checked = templateInput.parse(input);
  seedSetup(checked.data);
  const [row] = await db.query<Row>(
    "INSERT INTO project_templates(workspace_id,name,data,created_by) SELECT $1::uuid,$2::varchar,$3::jsonb,$4::varchar WHERE (SELECT count(*) FROM project_templates WHERE workspace_id=$1::uuid)<100 RETURNING id,name,data,created_at",
    [workspace, checked.name, JSON.stringify(checked.data), user],
  );
  if (!row)
    throw new Error(
      "The practice has 100 templates. Remove an unused template first.",
    );
  return fromRow(row);
}
export async function removeTemplate(db: Db, workspace: string, id: string) {
  return (
    (
      await db.query(
        "DELETE FROM project_templates WHERE workspace_id=$1 AND id=$2 RETURNING id",
        [workspace, id],
      )
    ).length > 0
  );
}
