import { publishEvent } from "@/lib/realtime/channel";
import { realtimeBus } from "@/lib/realtime/bus";
import { randomBytes } from "node:crypto";
import type { Db } from "@/lib/db";
import { getProject, projectDbId } from "@/lib/projects/store";
import { getForm, getWorkflow, label } from "@/lib/workflow";
import { normalizePlan, type Plan } from "@/lib/plan/geometry";
import { isInProject } from "@/lib/storage/blob";
import { tokenHash, validToken } from "@/lib/workspaces/store";
import type { CreateShareInput } from "./schema";
import type {
  ProjectShares,
  ShareComment,
  ShareLink,
  ShareTarget,
  SharedContent,
  SharedPage,
} from "./types";

export class ShareError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
const iso = (d: Date | string) => new Date(d).toISOString();
interface Row {
  id: string;
  workspace_id: string;
  project_id: string;
  target_type: ShareTarget["type"];
  target_id: string;
  phase_key: string;
  title: string;
  mode: "live" | "snapshot";
  permission: "view" | "comment" | "edit";
  expires_at: Date | string | null;
  revoked: boolean;
  revoked_at: Date | string | null;
  created_at: Date | string;
  view_count: number;
  last_viewed_at: Date | string | null;
  snapshot: {
    content: SharedContent;
    projectName: string;
    brand?: { name?: string; logoUrl?: string };
  } | null;
  frozen_file: { pathname: string; name: string } | null;
}
/** Share only the current drawing. Imported files, alternatives and working notes stay private. */
export function publicPlan(input: Plan): Plan {
  const p = normalizePlan(input);
  return {
    version: 1,
    levels: p.levels,
    walls: p.walls,
    openings: p.openings,
    columns: p.columns,
    rooms: p.rooms,
    items: p.items,
    dimensions: p.dimensions,
    notes: [],
    underlays: [],
    reference: [],
    layouts: [],
  };
}
async function targets(db: Db, workspaceId: string, slug: string) {
  const project = await getProject(db, workspaceId, slug);
  const id = await projectDbId(db, workspaceId, slug);
  if (!project || !id) throw new ShareError("Project not found", 404);
  const visibility = await db.query<{
    target_type: string;
    target_key: string;
    client_visible: boolean;
  }>(
    "SELECT target_type,target_key,client_visible FROM project_share_visibility WHERE workspace_id=$1 AND project_id=$2",
    [workspaceId, id],
  );
  const visible = (type: string, key: string) =>
    visibility.some(
      (v) => v.target_type === type && v.target_key === key && v.client_visible,
    );
  const phases = getWorkflow(project).phases.map((p) => ({
    key: p.key,
    name: p.name,
    clientVisible: visible("phase", p.key),
  }));
  const briefPhase =
    getWorkflow(project).phases.find((p) =>
      p.modules.some((m) => m === "structured_form:brief"),
    )?.key ?? getWorkflow(project).phases[0].key;
  const planPhase =
    getWorkflow(project).phases.find((p) =>
      p.modules.some((m) => m.split(":")[0] === "floor_plan_editor"),
    )?.key ?? "space_planning";
  const [plan] = await db.query(
    "SELECT project_id FROM floor_plans WHERE workspace_id=$1 AND project_id=$2",
    [workspaceId, id],
  );
  const list: ShareTarget[] = [
    {
      type: "brief",
      id,
      name: label(project, "brief", "Brief"),
      phaseKey: briefPhase,
      clientVisible: visible("brief", id),
      available: true,
    },
    {
      type: "plan",
      id,
      name: label(project, "floor_plan", "Floor plan"),
      phaseKey: planPhase,
      clientVisible: visible("plan", id),
      available: !!plan,
    },
    ...project.documents.map((d) => ({
      type: "document" as const,
      id: d.id,
      name: d.name,
      phaseKey: d.phaseKey,
      clientVisible: d.clientVisible,
      available: !!d.stored,
    })),
  ];
  return { project, id, phases, targets: list };
}
async function isVisible(
  db: Db,
  row: Pick<
    Row,
    "workspace_id" | "project_id" | "target_type" | "target_id" | "phase_key"
  >,
) {
  const [phase] = await db.query<{ client_visible: boolean }>(
    "SELECT client_visible FROM project_share_visibility WHERE workspace_id=$1 AND project_id=$2 AND target_type='phase' AND target_key=$3",
    [row.workspace_id, row.project_id, row.phase_key],
  );
  if (!phase?.client_visible) return false;
  const [target] =
    row.target_type === "document"
      ? await db.query<{ client_visible: boolean }>(
          "SELECT client_visible FROM documents WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
          [row.workspace_id, row.project_id, row.target_id],
        )
      : await db.query<{ client_visible: boolean }>(
          "SELECT client_visible FROM project_share_visibility WHERE workspace_id=$1 AND project_id=$2 AND target_type=$3 AND target_key=$4",
          [row.workspace_id, row.project_id, row.target_type, row.target_id],
        );
  return target?.client_visible === true;
}
function link(row: Row, available: boolean): ShareLink {
  return {
    id: row.id,
    targetType: row.target_type,
    targetId: row.target_id,
    title: row.title,
    mode: row.mode,
    permission: row.permission,
    createdAt: iso(row.created_at),
    expiresAt: row.expires_at ? iso(row.expires_at) : null,
    revokedAt: row.revoked_at
      ? iso(row.revoked_at)
      : row.revoked
        ? iso(row.created_at)
        : null,
    viewCount: row.view_count,
    lastViewedAt: row.last_viewed_at ? iso(row.last_viewed_at) : null,
    available,
  };
}
export async function listShares(
  db: Db,
  workspaceId: string,
  slug: string,
): Promise<ProjectShares> {
  const current = await targets(db, workspaceId, slug);
  const rows = await db.query<Row>(
    "SELECT * FROM share_links WHERE workspace_id=$1 AND project_id=$2 ORDER BY created_at DESC,id LIMIT 200",
    [workspaceId, current.id],
  );
  return {
    targets: current.targets,
    phases: current.phases,
    links: await Promise.all(
      rows.map(async (r) =>
        link(
          r,
          !r.revoked &&
            (!r.expires_at || new Date(r.expires_at) > new Date()) &&
            (await isVisible(db, r)),
        ),
      ),
    ),
  };
}
export async function setVisibility(
  db: Db,
  workspaceId: string,
  slug: string,
  input: { targetType: string; targetId?: string; clientVisible: boolean },
) {
  const current = await targets(db, workspaceId, slug);
  if (input.targetType === "document") {
    if (
      !current.targets.some(
        (t) => t.type === "document" && t.id === input.targetId,
      )
    )
      throw new ShareError("Document not found", 404);
    await db.query(
      "UPDATE documents SET client_visible=$4,updated_at=NOW() WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
      [workspaceId, current.id, input.targetId, input.clientVisible],
    );
  } else {
    const key = input.targetType === "phase" ? input.targetId : current.id;
    if (
      input.targetType === "phase" &&
      !current.phases.some((p) => p.key === key)
    )
      throw new ShareError("Phase not found", 404);
    await db.query(
      "INSERT INTO project_share_visibility(workspace_id,project_id,target_type,target_key,client_visible) VALUES($1,$2,$3,$4,$5) ON CONFLICT(workspace_id,project_id,target_type,target_key) DO UPDATE SET client_visible=EXCLUDED.client_visible",
      [workspaceId, current.id, input.targetType, key, input.clientVisible],
    );
  }
  return listShares(db, workspaceId, slug);
}
async function contentFor(
  db: Db,
  row: Pick<Row, "workspace_id" | "project_id" | "target_type" | "target_id">,
) {
  // One statement reads document, brief and plan against the same database snapshot.
  const [data] = await db.query<{
    slug: string;
    name: string;
    workflow_id: string;
    workflow_version: number;
    brief: Record<string, string>;
    geometry: Plan | null;
    revision: number | null;
    doc_name: string | null;
    file_type: string | null;
    file_location: string | null;
    size_bytes: string | null;
    version_number: number | null;
    settings: Record<string, unknown>;
  }>(
    `SELECT p.slug,p.name,p.workflow_id,p.workflow_version,p.brief,f.geometry,f.revision,d.name AS doc_name,d.file_type,d.file_location,d.size_bytes,d.version_number,w.settings FROM projects p JOIN workspaces w ON w.id=p.workspace_id LEFT JOIN floor_plans f ON f.project_id=p.id AND f.workspace_id=p.workspace_id LEFT JOIN documents d ON d.id=$3 AND d.project_id=p.id AND d.workspace_id=p.workspace_id WHERE p.workspace_id=$1 AND p.id=$2`,
    [
      row.workspace_id,
      row.project_id,
      row.target_type === "document" ? row.target_id : row.project_id,
    ],
  );
  if (!data) throw new ShareError("This link is unavailable", 404);
  let content: SharedContent;
  let file: { pathname: string; name: string } | null = null;
  if (row.target_type === "brief") {
    const form = getForm(
      { workflowId: data.workflow_id, workflowVersion: data.workflow_version },
      "brief",
    );
    content = {
      type: "brief",
      fields: (form?.fields ?? []).map((f) => ({
        key: f.key,
        label: f.label,
        value: data.brief[f.key] ?? "",
      })),
    };
  } else if (row.target_type === "plan") {
    if (!data.geometry)
      throw new ShareError("The plan has not been saved yet", 404);
    content = {
      type: "plan",
      plan: publicPlan(data.geometry),
      revision: data.revision ?? 1,
    };
  } else {
    if (
      !data.doc_name ||
      !data.file_location ||
      !isInProject(data.file_location, row.workspace_id, row.project_id)
    )
      throw new ShareError("The file is unavailable", 404);
    content = {
      type: "document",
      name: data.doc_name,
      fileType: data.file_type ?? "file",
      sizeBytes: Number(data.size_bytes ?? 0),
      version: data.version_number ?? 1,
      fileUrl: null,
    };
    file = { pathname: data.file_location, name: data.doc_name };
  }
  const raw = data.settings.branding as
    { name?: unknown; logoUrl?: unknown } | undefined;
  const branding = raw
    ? {
        name: typeof raw.name === "string" ? raw.name.slice(0, 255) : undefined,
        logoUrl:
          typeof raw.logoUrl === "string" &&
          URL.canParse(raw.logoUrl) &&
          new URL(raw.logoUrl).protocol === "https:"
            ? raw.logoUrl
            : undefined,
      }
    : undefined;
  return { content, projectName: data.name, file, brand: branding };
}
export async function createShare(
  db: Db,
  workspaceId: string,
  slug: string,
  userId: string,
  input: CreateShareInput,
) {
  const current = await targets(db, workspaceId, slug);
  const target = current.targets.find(
    (t) =>
      t.type === input.targetType &&
      (t.type !== "document" || t.id === input.targetId),
  );
  if (!target?.available)
    throw new ShareError("Save this document before sharing it");
  const base = {
    workspace_id: workspaceId,
    project_id: current.id,
    target_type: target.type,
    target_id: target.id,
    phase_key: target.phaseKey,
  };
  if (!(await isVisible(db, base)))
    throw new ShareError(
      "Make the document and its phase client-visible before creating a link",
    );
  if (input.expiresAt && new Date(input.expiresAt) <= new Date())
    throw new ShareError("Choose an expiry in the future");
  const frozen = input.mode === "snapshot" ? await contentFor(db, base) : null;
  const token = randomBytes(32).toString("base64url");
  const [row] = await db.query<Row>(
    `INSERT INTO share_links(workspace_id,project_id,token,target_type,target_id,phase_key,title,mode,permission,expires_at,snapshot,frozen_file,created_by)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13) RETURNING *`,
    [
      workspaceId,
      current.id,
      tokenHash(token),
      target.type,
      target.id,
      target.phaseKey,
      target.name,
      input.mode,
      input.permission,
      input.expiresAt ?? null,
      frozen
        ? JSON.stringify({
            content: frozen.content,
            projectName: frozen.projectName,
            brand: frozen.brand,
          })
        : null,
      frozen?.file ? JSON.stringify(frozen.file) : null,
      userId,
    ],
  );
  return { link: link(row, true), token };
}
export async function revokeShare(
  db: Db,
  workspaceId: string,
  slug: string,
  shareId: string,
) {
  const id = await projectDbId(db, workspaceId, slug);
  if (!id) throw new ShareError("Project not found", 404);
  const rows = await db.query(
    "UPDATE share_links SET revoked=TRUE,revoked_at=COALESCE(revoked_at,NOW()) WHERE workspace_id=$1 AND project_id=$2 AND id=$3 RETURNING id",
    [workspaceId, id, shareId],
  );
  if (!rows.length) throw new ShareError("Link not found", 404);
}
async function findPublic(db: Db, token: string): Promise<Row> {
  if (!validToken(token)) throw new ShareError("This link is unavailable", 404);
  const [row] = await db.query<Row>(
    "SELECT * FROM share_links WHERE token=$1 AND project_id IS NOT NULL AND NOT revoked AND (expires_at IS NULL OR expires_at>NOW())",
    [tokenHash(token)],
  );
  if (!row || !(await isVisible(db, row)))
    throw new ShareError("This link is unavailable", 404);
  return row;
}
async function commentsFor(db: Db, id: string): Promise<ShareComment[]> {
  const rows = await db.query<{
    id: string;
    parent_id: string | null;
    author_name: string;
    body: string;
    internal: boolean;
    created_at: Date | string;
  }>(
    "SELECT * FROM share_comments WHERE share_id=$1 ORDER BY created_at,id LIMIT 1000",
    [id],
  );
  return rows.map((r) => ({
    id: r.id,
    parentId: r.parent_id,
    authorName: r.author_name,
    body: r.body,
    internal: r.internal,
    createdAt: iso(r.created_at),
  }));
}
export async function readShared(
  db: Db,
  token: string,
  track = true,
): Promise<SharedPage> {
  const row = await findPublic(db, token);
  const value =
    row.mode === "snapshot" ? row.snapshot : await contentFor(db, row);
  if (!value) throw new ShareError("This link is unavailable", 404);
  if (track)
    await db.query(
      "UPDATE share_links SET view_count=view_count+1,last_viewed_at=NOW() WHERE id=$1 AND NOT revoked",
      [row.id],
    );
  const content =
    value.content.type === "document"
      ? { ...value.content, fileUrl: `/api/shared/${token}/file` }
      : value.content;
  return {
    share: {
      title: row.title,
      projectName: value.projectName,
      targetType: row.target_type,
      mode: row.mode,
      permission: row.permission,
      createdAt: iso(row.created_at),
      expiresAt: row.expires_at ? iso(row.expires_at) : null,
    },
    content,
    comments: await commentsFor(db, row.id),
    brand: value.brand,
  };
}
export async function sharedFile(db: Db, token: string) {
  const row = await findPublic(db, token);
  if (row.target_type !== "document")
    throw new ShareError("File not found", 404);
  const file =
    row.mode === "snapshot"
      ? row.frozen_file
      : (await contentFor(db, row)).file;
  if (!file || !isInProject(file.pathname, row.workspace_id, row.project_id))
    throw new ShareError("File unavailable", 404);
  return file;
}
async function addComment(
  db: Db,
  row: Row,
  input: { authorName: string; body: string; parentId?: string | null },
  internal: boolean,
) {
  if (input.parentId) {
    const [parent] = await db.query<{ parent_id: string | null }>(
      "SELECT parent_id FROM share_comments WHERE id=$1 AND share_id=$2",
      [input.parentId, row.id],
    );
    if (!parent || parent.parent_id)
      throw new ShareError("Reply to a comment in this document");
  }
  // Per-link limits bound unauthenticated writes without collecting client identities.
  const [comment] = await db.query<{ id: string; created_at: Date | string }>(
    `INSERT INTO share_comments(share_id,parent_id,author_name,body,internal) SELECT $1,$2,$3,$4,$5 WHERE (SELECT COUNT(*) FROM share_comments WHERE share_id=$1 AND created_at>NOW()-INTERVAL '1 minute')<10 AND (SELECT COUNT(*) FROM share_comments WHERE share_id=$1)<1000
      AND ($5::boolean OR EXISTS(
        SELECT 1 FROM share_links s WHERE s.id=$1 AND NOT s.revoked AND (s.expires_at IS NULL OR s.expires_at>NOW()) AND s.permission IN ('comment','edit')
        AND EXISTS(SELECT 1 FROM project_share_visibility v WHERE v.workspace_id=s.workspace_id AND v.project_id=s.project_id AND v.target_type='phase' AND v.target_key=s.phase_key AND v.client_visible)
        AND (CASE WHEN s.target_type='document' THEN EXISTS(SELECT 1 FROM documents d WHERE d.workspace_id=s.workspace_id AND d.project_id=s.project_id AND d.id::text=s.target_id::text AND d.client_visible)
          ELSE EXISTS(SELECT 1 FROM project_share_visibility v WHERE v.workspace_id=s.workspace_id AND v.project_id=s.project_id AND v.target_type=s.target_type AND v.target_key=s.target_id::text AND v.client_visible) END)
      )) RETURNING id,created_at`,
    [row.id, input.parentId ?? null, input.authorName, input.body, internal],
  );
  if (!comment)
    throw new ShareError(
      "Please wait a minute before adding another comment",
      429,
    );
  return {
    id: comment.id,
    parentId: input.parentId ?? null,
    authorName: input.authorName,
    body: input.body,
    internal,
    createdAt: iso(comment.created_at),
  };
}
export async function commentShared(
  db: Db,
  token: string,
  input: { authorName: string; body: string; parentId?: string | null },
) {
  const row = await findPublic(db, token);
  if (row.permission === "view")
    throw new ShareError("This link allows viewing only", 403);
  return addComment(db, row, input, false);
}
export async function internalComments(
  db: Db,
  workspaceId: string,
  slug: string,
  shareId: string,
  input?: { authorName: string; body: string; parentId?: string | null },
) {
  const id = await projectDbId(db, workspaceId, slug);
  const [row] = await db.query<Row>(
    "SELECT * FROM share_links WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
    [workspaceId, id, shareId],
  );
  if (!row) throw new ShareError("Link not found", 404);
  return input ? addComment(db, row, input, true) : commentsFor(db, row.id);
}
export async function editSharedBrief(
  db: Db,
  token: string,
  patch: Record<string, string>,
) {
  const row = await findPublic(db, token);
  if (
    row.permission !== "edit" ||
    row.target_type !== "brief" ||
    row.mode !== "live"
  )
    throw new ShareError("This link does not allow editing", 403);
  const current = await contentFor(db, row);
  if (current.content.type !== "brief")
    throw new ShareError("Brief unavailable", 404);
  const keys = Object.keys(patch);
  if (
    keys.some(
      (k) =>
        !current.content.type ||
        current.content.type !== "brief" ||
        !current.content.fields.some((f) => f.key === k),
    )
  )
    throw new ShareError("Unknown brief field");
  // Recheck token and publication permission in the write, preventing a revoked link from saving.
  const result = await db.query(
    `UPDATE projects p SET brief=p.brief||$3::jsonb,brief_ai_fields=ARRAY(SELECT f FROM unnest(p.brief_ai_fields) f WHERE f<>ALL($4::text[])),last_activity_at=NOW(),updated_at=NOW() WHERE p.workspace_id=$1 AND p.id=$2 AND EXISTS(SELECT 1 FROM share_links s WHERE s.id=$5 AND NOT s.revoked AND (s.expires_at IS NULL OR s.expires_at>NOW())) AND EXISTS(SELECT 1 FROM project_share_visibility v WHERE v.workspace_id=$1 AND v.project_id=$2 AND v.target_type='brief' AND v.client_visible) AND EXISTS(SELECT 1 FROM project_share_visibility v WHERE v.workspace_id=$1 AND v.project_id=$2 AND v.target_type='phase' AND v.target_key=$6 AND v.client_visible) RETURNING p.id`,
    [
      row.workspace_id,
      row.project_id,
      JSON.stringify(patch),
      keys,
      row.id,
      row.phase_key,
    ],
  );
  if (!result.length) throw new ShareError("This link is unavailable", 404);
  const [project] = await db.query<{ slug: string }>(
    "SELECT slug FROM projects WHERE workspace_id=$1 AND id=$2",
    [row.workspace_id, row.project_id],
  );
  if (project)
    await publishEvent(db, {
      workspaceId: row.workspace_id,
      projectId: project.slug,
      type: "RECORD_AUTOSAVED",
      data: patch,
      phaseKey: row.phase_key,
    })
      .then((event) => realtimeBus.broadcast(event))
      .catch(() => undefined);
  return readShared(db, token, false);
}
