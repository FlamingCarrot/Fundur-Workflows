import type { Db } from "@/lib/db";
import { getProject, projectDbId } from "@/lib/projects/store";
import { getWorkflow } from "@/lib/workflow";
import { emptyDesign } from "./model";
import { designDataSchema, type DesignData, type DesignState } from "./schema";

export class DesignError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export class DesignConflict extends DesignError {
  constructor(public current: DesignState) {
    super(
      "This project was changed elsewhere. Review the saved version before saving your draft.",
      409,
    );
  }
}
export async function getDesign(
  db: Db,
  workspaceId: string,
  slug: string,
): Promise<DesignState> {
  const id = await projectDbId(db, workspaceId, slug);
  if (!id) throw new DesignError("Project not found", 404);
  const [row] = await db.query<{
    data: DesignData;
    revision: number;
    updated_at: Date;
  }>(
    "SELECT data,revision,updated_at FROM project_design WHERE workspace_id=$1 AND project_id=$2",
    [workspaceId, id],
  );
  return row
    ? {
        data: row.data,
        revision: row.revision,
        updatedAt: new Date(row.updated_at).toISOString(),
      }
    : { data: emptyDesign(), revision: 0 };
}
export async function saveDesign(
  db: Db,
  workspaceId: string,
  userId: string,
  slug: string,
  data: DesignData,
  baseRevision: number,
): Promise<DesignState> {
  const parsed = designDataSchema.safeParse(data);
  if (!parsed.success) throw new DesignError(parsed.error.issues[0].message);
  const project = await getProject(db, workspaceId, slug);
  const id = await projectDbId(db, workspaceId, slug);
  if (!project || !id) throw new DesignError("Project not found", 404);
  const keys = getWorkflow(project).phases.flatMap((p) =>
    p.modules
      .filter((m) => m.startsWith("canvas_board:"))
      .map((m) => m.slice("canvas_board:".length)),
  );
  if (data.boards.some((b) => !keys.includes(b.key)))
    throw new DesignError("This workflow does not contain that board");
  const refs = [
    ...new Set(
      [
        ...data.boards.flatMap((b) => b.cards.map((c) => c.documentId)),
        ...data.items.flatMap((i) => [i.documentId, ...i.snagDocumentIds]),
      ].filter((d): d is string => !!d),
    ),
  ];
  if (refs.length) {
    const docs = await db.query<{ id: string }>(
      "SELECT id FROM documents WHERE workspace_id=$1 AND project_id=$2 AND id=ANY($3::uuid[]) AND file_location<>'' AND lower(file_type) IN ('png','jpg','jpeg','gif','webp')",
      [workspaceId, id, refs],
    );
    if (docs.length !== refs.length)
      throw new DesignError("Choose an uploaded image from this project");
  }
  const [row] = await db.query<{
    data: DesignData;
    revision: number;
    updated_at: Date;
  }>(
    `INSERT INTO project_design(workspace_id,project_id,data,revision,updated_by) SELECT $1,$2,$3::jsonb,1,$4 WHERE $5=0
     ON CONFLICT(project_id) DO NOTHING RETURNING data,revision,updated_at`,
    [workspaceId, id, JSON.stringify(data), userId, baseRevision],
  );
  const saved =
    row ??
    (baseRevision > 0
      ? (
          await db.query<typeof row>(
            `UPDATE project_design SET data=$3::jsonb,revision=revision+1,updated_by=$4,updated_at=NOW() WHERE workspace_id=$1 AND project_id=$2 AND revision=$5 RETURNING data,revision,updated_at`,
            [workspaceId, id, JSON.stringify(data), userId, baseRevision],
          )
        )[0]
      : undefined);
  if (!saved) throw new DesignConflict(await getDesign(db, workspaceId, slug));
  // The project dashboard follows activity in its boards and registers too.
  await db.query(
    "UPDATE projects SET last_activity_at=NOW(),updated_at=NOW() WHERE workspace_id=$1 AND id=$2",
    [workspaceId, id],
  );
  return {
    data: saved.data,
    revision: saved.revision,
    updatedAt: new Date(saved.updated_at).toISOString(),
  };
}
