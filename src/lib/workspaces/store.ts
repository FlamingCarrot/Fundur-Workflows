import { createHash, randomBytes } from "node:crypto";
import type { Db } from "@/lib/db";
import type { WorkspaceRole } from "@/lib/auth/permissions";
import type { SessionUser } from "@/lib/auth/users";

export const FEATURE_KEYS = ["ai", "floor_plan", "layout", "sharing"] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];
export type FeatureState = Record<FeatureKey, boolean>;
export const DEFAULT_FEATURES: FeatureState = {
  ai: true,
  floor_plan: true,
  layout: true,
  sharing: true,
};
export const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export const validToken = (token: string) => /^[A-Za-z0-9_-]{43}$/.test(token);
export class AccessError extends Error {
  constructor(
    message: string,
    public status = 403,
  ) {
    super(message);
  }
}

export async function audit(
  db: Db,
  workspaceId: string | null,
  actor: string,
  action: string,
  subject?: string,
  details: unknown = {},
) {
  await db.query(
    "INSERT INTO workspace_audit(workspace_id,actor_id,action,subject,details) VALUES($1,$2,$3,$4,$5::jsonb)",
    [workspaceId, actor, action, subject ?? null, JSON.stringify(details)],
  );
}
export async function memberships(db: Db, userId: string) {
  return db.query<{ id: string; name: string; role: WorkspaceRole }>(
    "SELECT w.id,w.name,m.role FROM memberships m JOIN workspaces w ON w.id=m.workspace_id WHERE m.user_id=$1 ORDER BY m.created_at,w.id",
    [userId],
  );
}
export async function features(
  db: Db,
  workspaceId: string,
  userId: string,
): Promise<FeatureState> {
  const state = { ...DEFAULT_FEATURES };
  const rows = await db.query<{ feature_key: FeatureKey; enabled: boolean }>(
    "SELECT feature_key,enabled FROM workspace_user_features WHERE workspace_id=$1 AND user_id=$2",
    [workspaceId, userId],
  );
  for (const row of rows) state[row.feature_key] = row.enabled;
  return state;
}
export async function canAccessProject(
  db: Db,
  workspaceId: string,
  userId: string,
  role: WorkspaceRole,
  slug: string,
) {
  const rows = await db.query(
    "SELECT p.id FROM projects p WHERE p.workspace_id=$1 AND p.slug=$2 AND ($3::boolean OR EXISTS(SELECT 1 FROM project_members pm WHERE pm.workspace_id=p.workspace_id AND pm.project_id=p.id AND pm.user_id=$4))",
    [workspaceId, slug, role !== "collaborator", userId],
  );
  return rows.length > 0;
}
export async function projectSlugs(
  db: Db,
  workspaceId: string,
  userId: string,
  role: WorkspaceRole,
): Promise<string[] | null> {
  if (role !== "collaborator") return null;
  const rows = await db.query<{ slug: string }>(
    "SELECT p.slug FROM projects p JOIN project_members pm ON pm.project_id=p.id AND pm.workspace_id=p.workspace_id WHERE p.workspace_id=$1 AND pm.user_id=$2",
    [workspaceId, userId],
  );
  return rows.map((r) => r.slug);
}
export async function invite(
  db: Db,
  workspaceId: string,
  actor: string,
  email: string,
  role: Exclude<WorkspaceRole, "client">,
  projectIds: string[] = [],
) {
  const ids = [...new Set(projectIds)];
  if (ids.length) {
    const rows = await db.query<{ id: string }>(
      "SELECT id FROM projects WHERE workspace_id=$1 AND id=ANY($2::uuid[])",
      [workspaceId, ids],
    );
    if (rows.length !== ids.length)
      throw new AccessError("Choose projects from this workspace", 400);
  }
  const token = randomBytes(32).toString("base64url");
  const [row] = await db.query<{ id: string }>(
    "INSERT INTO workspace_invitations(workspace_id,token_hash,email,role,project_ids,created_by,expires_at) VALUES($1,$2,$3,$4,$5,$6,NOW()+INTERVAL '7 days') RETURNING id",
    [
      workspaceId,
      tokenHash(token),
      email.trim().toLowerCase(),
      role,
      role === "collaborator" ? ids : [],
      actor,
    ],
  );
  await audit(db, workspaceId, actor, "invitation.created", row.id, {
    email,
    role,
    projectIds: ids,
  });
  return { id: row.id, token };
}
export async function invitationInfo(db: Db, token: string) {
  if (!validToken(token)) return null;
  const [row] = await db.query<{
    id: string;
    workspace_id: string;
    name: string;
    email: string;
    role: WorkspaceRole;
  }>(
    "SELECT i.id,i.workspace_id,w.name,i.email,i.role FROM workspace_invitations i JOIN workspaces w ON w.id=i.workspace_id WHERE i.token_hash=$1 AND i.revoked_at IS NULL AND i.accepted_at IS NULL AND i.expires_at>NOW()",
    [tokenHash(token)],
  );
  return row ?? null;
}
export async function acceptInvitation(
  db: Db,
  token: string,
  user: SessionUser,
) {
  if (!validToken(token) || !user.email || user.email_verified !== true)
    throw new AccessError(
      "Sign in with the verified email address on the invitation",
    );
  const [row] = await db.query<{ workspace_id: string }>(
    `WITH claimed AS (
 UPDATE workspace_invitations SET accepted_by=$2,accepted_at=NOW() WHERE token_hash=$1 AND email=$3 AND revoked_at IS NULL AND accepted_at IS NULL AND expires_at>NOW() AND EXISTS(SELECT 1 FROM users WHERE id=$2 AND active) RETURNING *
 ), membership AS (
 INSERT INTO memberships(workspace_id,user_id,role) SELECT workspace_id,$2,role FROM claimed ON CONFLICT(workspace_id,user_id) DO NOTHING RETURNING workspace_id
 ), access AS (
 INSERT INTO project_members(workspace_id,project_id,user_id) SELECT c.workspace_id,p.id,$2 FROM claimed c JOIN projects p ON p.workspace_id=c.workspace_id AND p.id=ANY(c.project_ids) ON CONFLICT DO NOTHING
 ) SELECT workspace_id FROM claimed`,
    [tokenHash(token), user.sub, user.email.trim().toLowerCase()],
  );
  if (!row)
    throw new AccessError(
      "This invitation is unavailable or belongs to another email address",
      404,
    );
  await audit(db, row.workspace_id, user.sub, "invitation.accepted", user.sub);
  return row.workspace_id;
}
export async function workspaceSummary(db: Db, workspaceId: string) {
  const [workspace] = await db.query<{
    id: string;
    name: string;
    settings: Record<string, unknown>;
  }>("SELECT id,name,settings FROM workspaces WHERE id=$1", [workspaceId]);
  const users = await db.query<{
    id: string;
    email: string;
    name: string | null;
    platform_role: string;
    role: WorkspaceRole;
    active: boolean;
  }>(
    "SELECT u.id,u.email,u.name,u.platform_role,m.role,u.active FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=$1 ORDER BY u.name,u.email",
    [workspaceId],
  );
  const projects = await db.query<{ id: string; slug: string; name: string }>(
    "SELECT id,slug,name FROM projects WHERE workspace_id=$1 ORDER BY name",
    [workspaceId],
  );
  const access = await db.query<{ user_id: string; project_id: string }>(
    "SELECT user_id,project_id FROM project_members WHERE workspace_id=$1",
    [workspaceId],
  );
  const flags = await db.query<{
    user_id: string;
    feature_key: FeatureKey;
    enabled: boolean;
  }>(
    "SELECT user_id,feature_key,enabled FROM workspace_user_features WHERE workspace_id=$1",
    [workspaceId],
  );
  const invitations = await db.query(
    "SELECT id,email,role,expires_at,revoked_at,accepted_at FROM workspace_invitations WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 100",
    [workspaceId],
  );
  const changes = await db.query(
    "SELECT action,subject,details,created_at FROM workspace_audit WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 50",
    [workspaceId],
  );
  return { workspace, users, projects, access, flags, invitations, changes };
}
export async function updateMember(
  db: Db,
  workspaceId: string,
  actor: string,
  userId: string,
  change: {
    role?: Exclude<WorkspaceRole, "client">;
    projectIds?: string[];
    active?: boolean;
    platformRole?: "admin" | "user";
  },
) {
  const [member] = await db.query<{ role: string }>(
    "SELECT role FROM memberships WHERE workspace_id=$1 AND user_id=$2",
    [workspaceId, userId],
  );
  if (!member) throw new AccessError("Member not found", 404);
  if (
    userId === actor &&
    (change.active === false || change.platformRole === "user")
  )
    throw new AccessError(
      "You cannot deactivate or remove your own administrator access",
      400,
    );
  if (
    member.role === "owner" &&
    ((change.role && change.role !== "owner") || change.active === false)
  ) {
    const others = await db.query(
      "SELECT m.id FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.role='owner' AND m.user_id<>$2 AND u.active",
      [workspaceId, userId],
    );
    if (!others.length)
      throw new AccessError(
        "Keep at least one active owner in the workspace",
        400,
      );
  }
  const ids = [...new Set(change.projectIds ?? [])];
  if (change.projectIds) {
    const found = await db.query(
      "SELECT id FROM projects WHERE workspace_id=$1 AND id=ANY($2::uuid[])",
      [workspaceId, ids],
    );
    if (found.length !== ids.length)
      throw new AccessError("Choose projects from this workspace", 400);
  }
  if (change.role)
    await db.query(
      "UPDATE memberships SET role=$3 WHERE workspace_id=$1 AND user_id=$2",
      [workspaceId, userId, change.role],
    );
  if (change.projectIds)
    await db.query(
      `WITH removed AS (DELETE FROM project_members WHERE workspace_id=$1 AND user_id=$2 AND NOT(project_id=ANY($3::uuid[]))) INSERT INTO project_members(workspace_id,project_id,user_id) SELECT $1,p.id,$2 FROM projects p WHERE p.workspace_id=$1 AND p.id=ANY($3::uuid[]) ON CONFLICT DO NOTHING`,
      [workspaceId, userId, ids],
    );
  if (change.active !== undefined || change.platformRole)
    await db.query(
      "UPDATE users SET active=COALESCE($2,active),platform_role=COALESCE($3,platform_role),role_managed=CASE WHEN $3::text IS NOT NULL THEN TRUE ELSE role_managed END,updated_at=NOW() WHERE id=$1",
      [userId, change.active ?? null, change.platformRole ?? null],
    );
  await audit(db, workspaceId, actor, "member.updated", userId, change);
}
