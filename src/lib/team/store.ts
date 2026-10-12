import { randomBytes } from "node:crypto";
import type { Db } from "@/lib/db";
import { getProject, projectDbId } from "@/lib/projects/store";
import { audit, AccessError, tokenHash, validToken } from "@/lib/workspaces/store";
import type { WorkspaceRole } from "@/lib/auth/permissions";
import type { Project } from "@/lib/studio/types";
import { projectAccessSchema, tidyAccess, type ProjectAccess } from "./access";
import {
  clientViewSettingsSchema,
  sameEmail,
  tidyClientSettings,
  type ClientInvite,
  type ClientViewSettings,
} from "./client-view";
import {
  inChat,
  whiteboardNoteSchema,
  type ChatMessage,
  type TeamChat,
  type TeamComment,
  type TeamMember,
  type WhiteboardNote,
  type WhiteboardOp,
} from "./space";

/** The project's database id, or a 404 the routes pass on. */
async function projectId(db: Db, workspaceId: string, slug: string): Promise<string> {
  const id = await projectDbId(db, workspaceId, slug);
  if (!id) throw new AccessError("Project not found", 404);
  return id;
}
const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);

// ---------------------------------------------------------------------------
// Who is on the project, and what each may do
// ---------------------------------------------------------------------------

/**
 * Everyone who can open the project: the studio's owners and members, and
 * collaborators given this project. Each carries their access, when narrowed.
 */
export async function projectTeam(
  db: Db,
  workspaceId: string,
  slug: string,
): Promise<(TeamMember & { access: ProjectAccess | null; active: boolean })[]> {
  const id = await projectId(db, workspaceId, slug);
  const rows = await db.query<{
    id: string;
    name: string | null;
    email: string;
    role: WorkspaceRole;
    active: boolean;
    access: ProjectAccess | null;
  }>(
    `SELECT u.id,u.name,u.email,m.role,u.active,a.access FROM memberships m JOIN users u ON u.id=m.user_id
     LEFT JOIN project_member_access a ON a.workspace_id=m.workspace_id AND a.project_id=$2 AND a.user_id=u.id
     WHERE m.workspace_id=$1 AND m.role<>'client' AND (m.role<>'collaborator' OR EXISTS(SELECT 1 FROM project_members pm WHERE pm.workspace_id=$1 AND pm.project_id=$2 AND pm.user_id=u.id))
     ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'member' THEN 1 ELSE 2 END, u.name, u.email`,
    [workspaceId, id],
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name || r.email,
    email: r.email,
    role: r.role,
    active: r.active,
    access: r.access ? projectAccessSchema.parse(r.access) : null,
  }));
}

/** A teammate's access to a project; null is full access. Owners always have full access. */
export async function memberAccess(
  db: Db,
  workspaceId: string,
  slug: string,
  userId: string,
  role: WorkspaceRole,
): Promise<ProjectAccess | null> {
  if (role === "owner") return null;
  const [row] = await db.query<{ access: ProjectAccess }>(
    "SELECT a.access FROM project_member_access a JOIN projects p ON p.id=a.project_id AND p.workspace_id=a.workspace_id WHERE a.workspace_id=$1 AND p.slug=$2 AND a.user_id=$3",
    [workspaceId, slug, userId],
  );
  if (!row) return null;
  const parsed = projectAccessSchema.safeParse(row.access);
  // A record that no longer reads is treated as view only rather than as full access.
  return parsed.success ? parsed.data : { level: "view", hiddenPhases: [], hiddenSteps: [], hiddenTools: [] };
}

/** Each project's narrowed access for one person, by slug; projects missing from it are open to them. */
export async function accessByProject(
  db: Db,
  workspaceId: string,
  userId: string,
  role: WorkspaceRole,
): Promise<Map<string, ProjectAccess>> {
  if (role === "owner") return new Map();
  const rows = await db.query<{ slug: string; access: unknown }>(
    "SELECT p.slug,a.access FROM project_member_access a JOIN projects p ON p.id=a.project_id AND p.workspace_id=a.workspace_id WHERE a.workspace_id=$1 AND a.user_id=$2",
    [workspaceId, userId],
  );
  return new Map(
    rows.map((r) => {
      const parsed = projectAccessSchema.safeParse(r.access);
      return [r.slug, parsed.success ? parsed.data : { level: "view" as const, hiddenPhases: [], hiddenSteps: [], hiddenTools: [] }];
    }),
  );
}

/** Sets one teammate's access; null gives full access back. Owners can't be narrowed. */
export async function setMemberAccess(
  db: Db,
  workspaceId: string,
  slug: string,
  actor: string,
  userId: string,
  access: ProjectAccess | null,
): Promise<void> {
  const project = await getProject(db, workspaceId, slug);
  const id = await projectId(db, workspaceId, slug);
  if (!project) throw new AccessError("Project not found", 404);
  const team = await projectTeam(db, workspaceId, slug);
  const member = team.find((m) => m.id === userId);
  if (!member) throw new AccessError("Add this person to the project first", 404);
  if (member.role === "owner") throw new AccessError("Owners always have full access", 400);
  if (!access) {
    await db.query("DELETE FROM project_member_access WHERE workspace_id=$1 AND project_id=$2 AND user_id=$3", [workspaceId, id, userId]);
  } else {
    const tidy = tidyAccess(project, projectAccessSchema.parse(access));
    await db.query(
      `INSERT INTO project_member_access(workspace_id,project_id,user_id,access,updated_by) VALUES($1,$2,$3,$4::jsonb,$5)
       ON CONFLICT(workspace_id,project_id,user_id) DO UPDATE SET access=EXCLUDED.access,updated_by=EXCLUDED.updated_by,updated_at=NOW()`,
      [workspaceId, id, userId, JSON.stringify(tidy), actor],
    );
  }
  await audit(db, workspaceId, actor, "project_access.updated", userId, { project: slug, access });
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

interface CommentRow {
  id: string;
  anchor: string;
  parent_id: string | null;
  author_id: string;
  author_name: string;
  body: string;
  created_at: Date;
  resolved_at: Date | null;
}
const toComment = (r: CommentRow): TeamComment => ({
  id: r.id,
  anchor: r.anchor,
  parentId: r.parent_id,
  authorId: r.author_id,
  authorName: r.author_name,
  body: r.body,
  createdAt: iso(r.created_at)!,
  resolvedAt: iso(r.resolved_at),
});

/** Comments on one anchor, or on every anchor whose name starts with a prefix ("step:"), oldest first. */
export async function listComments(
  db: Db,
  workspaceId: string,
  slug: string,
  anchor?: string,
): Promise<TeamComment[]> {
  const id = await projectId(db, workspaceId, slug);
  const rows = await db.query<CommentRow>(
    `SELECT id,anchor,parent_id,author_id,author_name,body,created_at,resolved_at FROM project_comments
     WHERE workspace_id=$1 AND project_id=$2 AND ($3::text IS NULL OR anchor=$3 OR ($3 LIKE '%:' AND starts_with(anchor,$3)))
     ORDER BY created_at LIMIT 1000`,
    [workspaceId, id, anchor ?? null],
  );
  return rows.map(toComment);
}

export async function addComment(
  db: Db,
  workspaceId: string,
  slug: string,
  author: { id: string; name: string },
  input: { anchor: string; body: string; parentId?: string | null },
): Promise<TeamComment> {
  const id = await projectId(db, workspaceId, slug);
  if (input.parentId) {
    const [parent] = await db.query<{ anchor: string }>(
      "SELECT anchor FROM project_comments WHERE id=$1 AND workspace_id=$2 AND project_id=$3 AND parent_id IS NULL",
      [input.parentId, workspaceId, id],
    );
    if (!parent || parent.anchor !== input.anchor) throw new AccessError("Reply to a comment on this project", 400);
  }
  const [row] = await db.query<CommentRow>(
    `INSERT INTO project_comments(workspace_id,project_id,anchor,parent_id,author_id,author_name,body) VALUES($1,$2,$3,$4,$5,$6,$7)
     RETURNING id,anchor,parent_id,author_id,author_name,body,created_at,resolved_at`,
    [workspaceId, id, input.anchor, input.parentId ?? null, author.id, author.name.slice(0, 255), input.body],
  );
  await touch(db, workspaceId, id);
  return toComment(row);
}

/** Marks a comment thread resolved or open again. */
export async function resolveComment(
  db: Db,
  workspaceId: string,
  slug: string,
  commentId: string,
  userId: string,
  resolved: boolean,
): Promise<TeamComment> {
  const id = await projectId(db, workspaceId, slug);
  const [row] = await db.query<CommentRow>(
    `UPDATE project_comments SET resolved_at=CASE WHEN $4 THEN NOW() ELSE NULL END,resolved_by=CASE WHEN $4 THEN $5 ELSE NULL END
     WHERE id=$1 AND workspace_id=$2 AND project_id=$3 RETURNING id,anchor,parent_id,author_id,author_name,body,created_at,resolved_at`,
    [commentId, workspaceId, id, resolved, userId],
  );
  if (!row) throw new AccessError("Comment not found", 404);
  return toComment(row);
}

/** Only the person who wrote a comment, or a workspace owner, deletes it. */
export async function deleteComment(
  db: Db,
  workspaceId: string,
  slug: string,
  commentId: string,
  userId: string,
  isOwner: boolean,
): Promise<void> {
  const id = await projectId(db, workspaceId, slug);
  const rows = await db.query(
    "DELETE FROM project_comments WHERE id=$1 AND workspace_id=$2 AND project_id=$3 AND ($4 OR author_id=$5) RETURNING id",
    [commentId, workspaceId, id, isOwner, userId],
  );
  if (!rows.length) throw new AccessError("Only its author can delete this comment", 403);
}

// ---------------------------------------------------------------------------
// Whiteboard
// ---------------------------------------------------------------------------

export async function listNotes(db: Db, workspaceId: string, slug: string): Promise<WhiteboardNote[]> {
  const id = await projectId(db, workspaceId, slug);
  const rows = await db.query<{ note: unknown; updated_at: Date; updated_by: string }>(
    "SELECT note,updated_at,updated_by FROM project_whiteboard_notes WHERE workspace_id=$1 AND project_id=$2 ORDER BY updated_at LIMIT 1000",
    [workspaceId, id],
  );
  return rows.flatMap((r) => {
    const parsed = whiteboardNoteSchema.safeParse(r.note);
    return parsed.success ? [{ ...parsed.data, updatedAt: iso(r.updated_at)!, updatedBy: r.updated_by }] : [];
  });
}

/** Applies one change to one note; the rest of the board is untouched. */
export async function applyWhiteboardOp(
  db: Db,
  workspaceId: string,
  slug: string,
  userName: string,
  op: WhiteboardOp,
): Promise<void> {
  const id = await projectId(db, workspaceId, slug);
  if (op.type === "remove") {
    await db.query("DELETE FROM project_whiteboard_notes WHERE id=$1 AND workspace_id=$2 AND project_id=$3", [op.id, workspaceId, id]);
    return;
  }
  const [count] = await db.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM project_whiteboard_notes WHERE workspace_id=$1 AND project_id=$2",
    [workspaceId, id],
  );
  const rows = await db.query(
    `INSERT INTO project_whiteboard_notes(id,workspace_id,project_id,note,updated_by) SELECT $1,$2,$3,$4::jsonb,$5 WHERE $6 OR EXISTS(SELECT 1 FROM project_whiteboard_notes WHERE id=$1)
     ON CONFLICT(id) DO UPDATE SET note=EXCLUDED.note,updated_by=EXCLUDED.updated_by,updated_at=NOW()
     WHERE project_whiteboard_notes.workspace_id=$2 AND project_whiteboard_notes.project_id=$3 RETURNING id`,
    [op.note.id, workspaceId, id, JSON.stringify(op.note), userName.slice(0, 255), (count?.n ?? 0) < 1000],
  );
  if (!rows.length) {
    const [exists] = await db.query("SELECT 1 FROM project_whiteboard_notes WHERE id=$1", [op.note.id]);
    throw new AccessError(exists ? "Note not found" : "This whiteboard is full. Remove some notes first.", exists ? 404 : 400);
  }
  await touch(db, workspaceId, id);
}

// ---------------------------------------------------------------------------
// Chats
// ---------------------------------------------------------------------------

interface ChatRow {
  id: string;
  name: string;
  member_ids: string[];
  created_by: string;
  created_at: Date;
  last_message_at: Date | null;
}
const toChat = (r: ChatRow): TeamChat => ({
  id: r.id,
  name: r.name,
  memberIds: r.member_ids ?? [],
  createdBy: r.created_by,
  createdAt: iso(r.created_at)!,
  lastMessageAt: iso(r.last_message_at),
});

/** The chats this person is in, the project's "Everyone" chat first. */
export async function listChats(db: Db, workspaceId: string, slug: string, userId: string): Promise<TeamChat[]> {
  const id = await projectId(db, workspaceId, slug);
  await db.query(
    `INSERT INTO project_chats(workspace_id,project_id,name,member_ids,created_by) VALUES($1,$2,'Everyone','{}',$3)
     ON CONFLICT (project_id) WHERE cardinality(member_ids) = 0 DO NOTHING`,
    [workspaceId, id, userId],
  );
  const rows = await db.query<ChatRow>(
    "SELECT id,name,member_ids,created_by,created_at,last_message_at FROM project_chats WHERE workspace_id=$1 AND project_id=$2 ORDER BY cardinality(member_ids)=0 DESC, created_at",
    [workspaceId, id],
  );
  return rows.map(toChat).filter((c) => inChat(c, userId));
}

export async function createChat(
  db: Db,
  workspaceId: string,
  slug: string,
  userId: string,
  input: { name: string; memberIds: string[] },
): Promise<TeamChat> {
  const id = await projectId(db, workspaceId, slug);
  const team = new Set((await projectTeam(db, workspaceId, slug)).map((m) => m.id));
  const members = [...new Set([userId, ...input.memberIds])];
  if (members.some((m) => !team.has(m))) throw new AccessError("Choose people who are on this project", 400);
  if (members.length < 2) throw new AccessError("Choose at least one other person", 400);
  const [row] = await db.query<ChatRow>(
    "INSERT INTO project_chats(workspace_id,project_id,name,member_ids,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id,name,member_ids,created_by,created_at,last_message_at",
    [workspaceId, id, input.name, members, userId],
  );
  return toChat(row);
}

async function chatFor(db: Db, workspaceId: string, slug: string, chatId: string, userId: string): Promise<TeamChat> {
  const id = await projectId(db, workspaceId, slug);
  const [row] = await db.query<ChatRow>(
    "SELECT id,name,member_ids,created_by,created_at,last_message_at FROM project_chats WHERE id=$1 AND workspace_id=$2 AND project_id=$3",
    [chatId, workspaceId, id],
  );
  if (!row || !inChat(toChat(row), userId)) throw new AccessError("Chat not found", 404);
  return toChat(row);
}

export async function listMessages(
  db: Db,
  workspaceId: string,
  slug: string,
  chatId: string,
  userId: string,
): Promise<ChatMessage[]> {
  await chatFor(db, workspaceId, slug, chatId, userId);
  const rows = await db.query<{ id: string; chat_id: string; author_id: string; author_name: string; body: string; created_at: Date }>(
    "SELECT * FROM (SELECT id,chat_id,author_id,author_name,body,created_at FROM project_chat_messages WHERE chat_id=$1 ORDER BY created_at DESC LIMIT 200) m ORDER BY created_at",
    [chatId],
  );
  return rows.map((r) => ({
    id: r.id,
    chatId: r.chat_id,
    authorId: r.author_id,
    authorName: r.author_name,
    body: r.body,
    createdAt: iso(r.created_at)!,
  }));
}

export async function postMessage(
  db: Db,
  workspaceId: string,
  slug: string,
  chatId: string,
  author: { id: string; name: string },
  body: string,
): Promise<ChatMessage> {
  await chatFor(db, workspaceId, slug, chatId, author.id);
  const [row] = await db.query<{ id: string; created_at: Date }>(
    "INSERT INTO project_chat_messages(chat_id,author_id,author_name,body) VALUES($1,$2,$3,$4) RETURNING id,created_at",
    [chatId, author.id, author.name.slice(0, 255), body],
  );
  await db.query("UPDATE project_chats SET last_message_at=$2 WHERE id=$1", [chatId, row.created_at]);
  return { id: row.id, chatId, authorId: author.id, authorName: author.name, body, createdAt: iso(row.created_at)! };
}

async function touch(db: Db, workspaceId: string, projectDb: string) {
  await db.query("UPDATE projects SET last_activity_at=NOW() WHERE workspace_id=$1 AND id=$2", [workspaceId, projectDb]);
}

// ---------------------------------------------------------------------------
// Client progress page
// ---------------------------------------------------------------------------

interface InviteRow {
  id: string;
  email: string;
  settings: ClientViewSettings;
  created_at: Date;
  revoked_at: Date | null;
  last_opened_at: Date | null;
  open_count: number;
}
const toInvite = (r: InviteRow): ClientInvite => ({
  id: r.id,
  email: r.email,
  settings: clientViewSettingsSchema.parse(r.settings),
  createdAt: iso(r.created_at)!,
  revokedAt: iso(r.revoked_at),
  lastOpenedAt: iso(r.last_opened_at),
  openCount: Number(r.open_count),
});
const INVITE_COLUMNS = "id,email,settings,created_at,revoked_at,last_opened_at,open_count";

export async function listClientInvites(db: Db, workspaceId: string, slug: string): Promise<ClientInvite[]> {
  const id = await projectId(db, workspaceId, slug);
  const rows = await db.query<InviteRow>(
    `SELECT ${INVITE_COLUMNS} FROM client_invites WHERE workspace_id=$1 AND project_id=$2 ORDER BY created_at DESC LIMIT 100`,
    [workspaceId, id],
  );
  return rows.map(toInvite);
}

/** Invites one email address; the token is returned once and only its hash is kept. */
export async function createClientInvite(
  db: Db,
  workspaceId: string,
  slug: string,
  actor: string,
  email: string,
  settings: ClientViewSettings,
): Promise<{ invite: ClientInvite; token: string }> {
  const project = await getProject(db, workspaceId, slug);
  const id = await projectId(db, workspaceId, slug);
  if (!project) throw new AccessError("Project not found", 404);
  const token = randomBytes(32).toString("base64url");
  const [row] = await db.query<InviteRow>(
    `INSERT INTO client_invites(workspace_id,project_id,email,token_hash,settings,created_by) VALUES($1,$2,$3,$4,$5::jsonb,$6) RETURNING ${INVITE_COLUMNS}`,
    [workspaceId, id, email.trim().toLowerCase(), tokenHash(token), JSON.stringify(tidyClientSettings(project, settings)), actor],
  );
  await audit(db, workspaceId, actor, "client_invite.created", row.id, { project: slug, email: row.email });
  return { invite: toInvite(row), token };
}

export async function updateClientInvite(
  db: Db,
  workspaceId: string,
  slug: string,
  actor: string,
  inviteId: string,
  change: { settings?: ClientViewSettings; revoke?: boolean },
): Promise<ClientInvite> {
  const project = await getProject(db, workspaceId, slug);
  const id = await projectId(db, workspaceId, slug);
  if (!project) throw new AccessError("Project not found", 404);
  const [row] = await db.query<InviteRow>(
    `UPDATE client_invites SET settings=COALESCE($4::jsonb,settings),revoked_at=CASE WHEN $5 THEN COALESCE(revoked_at,NOW()) ELSE revoked_at END
     WHERE id=$1 AND workspace_id=$2 AND project_id=$3 RETURNING ${INVITE_COLUMNS}`,
    [inviteId, workspaceId, id, change.settings ? JSON.stringify(tidyClientSettings(project, change.settings)) : null, change.revoke === true],
  );
  if (!row) throw new AccessError("Invite not found", 404);
  await audit(db, workspaceId, actor, change.revoke ? "client_invite.revoked" : "client_invite.updated", inviteId, { project: slug });
  return toInvite(row);
}

export type ClientOpenResult =
  | { ok: true; project: Project; settings: ClientViewSettings; studio: string; brand?: { name?: string; logoUrl?: string }; workspaceId: string; projectDbId: string }
  | { ok: false; reason: "unavailable" | "wrong_person" };

/**
 * Opens a client page for a signed-in person. Only the invited, verified email
 * gets it; anyone else, and any revoked or unknown link, is turned away.
 */
export async function openClientInvite(
  db: Db,
  token: string,
  person: { email?: string | null; emailVerified?: boolean | null },
  count = true,
): Promise<ClientOpenResult> {
  if (!validToken(token)) return { ok: false, reason: "unavailable" };
  const [row] = await db.query<{ id: string; workspace_id: string; project_id: string; email: string; settings: unknown; slug: string; studio: string; ws_settings: Record<string, unknown> | null }>(
    `SELECT i.id,i.workspace_id,i.project_id,i.email,i.settings,p.slug,w.name AS studio,w.settings AS ws_settings FROM client_invites i
     JOIN projects p ON p.id=i.project_id AND p.workspace_id=i.workspace_id JOIN workspaces w ON w.id=i.workspace_id
     WHERE i.token_hash=$1 AND i.revoked_at IS NULL`,
    [tokenHash(token)],
  );
  if (!row) return { ok: false, reason: "unavailable" };
  if (person.emailVerified !== true || !sameEmail(person.email, row.email)) return { ok: false, reason: "wrong_person" };
  const project = await getProject(db, row.workspace_id, row.slug);
  const settings = clientViewSettingsSchema.safeParse(row.settings);
  if (!project || !settings.success) return { ok: false, reason: "unavailable" };
  if (count)
    await db.query("UPDATE client_invites SET open_count=open_count+1,last_opened_at=NOW() WHERE id=$1", [row.id]);
  const raw = row.ws_settings?.branding as { name?: unknown; logoUrl?: unknown } | undefined;
  const brand = raw
    ? {
        name: typeof raw.name === "string" ? raw.name.slice(0, 255) : undefined,
        logoUrl:
          typeof raw.logoUrl === "string" && URL.canParse(raw.logoUrl) && new URL(raw.logoUrl).protocol === "https:"
            ? raw.logoUrl
            : undefined,
      }
    : undefined;
  return {
    ok: true,
    project,
    settings: tidyClientSettings(project, settings.data),
    studio: brand?.name || row.studio,
    brand,
    workspaceId: row.workspace_id,
    projectDbId: row.project_id,
  };
}

/** Where a client-visible document of an opened page is stored, or null. */
export async function clientDocumentFile(
  db: Db,
  workspaceId: string,
  projectDb: string,
  documentId: string,
): Promise<{ pathname: string; name: string } | null> {
  const [row] = await db.query<{ file_location: string; name: string }>(
    "SELECT file_location,name FROM documents WHERE id=$1 AND workspace_id=$2 AND project_id=$3 AND client_visible AND file_location<>''",
    [documentId, workspaceId, projectDb],
  );
  return row ? { pathname: row.file_location, name: row.name } : null;
}
