import type { Db } from "@/lib/db";
import type { WebSourceItem } from "./chat-items";

/**
 * Documents written in the chat: drafts, letters, specs and research reports.
 * Each opens in the chat's canvas, where she and the assistant both edit it;
 * every save keeps the text before it as a version she can go back to.
 */

export interface ChatDocument {
  id: string;
  kind: "document" | "research";
  title: string;
  content: string;
  sources: WebSourceItem[];
  version: number;
  projectId: string | null;
  updatedAt: string;
}

export interface ChatDocumentVersion {
  version: number;
  title: string;
  savedAt: string;
}

export const MAX_DOCUMENT_CHARS = 200_000;
const iso = (v: Date | string) => new Date(v).toISOString();

type Row = { id: string; kind: string; title: string; content: string; sources: unknown; version: number; project_id: string | null; updated_at: Date | string };

const view = (r: Row): ChatDocument => ({
  id: r.id,
  kind: r.kind === "research" ? "research" : "document",
  title: r.title,
  content: r.content,
  sources: (typeof r.sources === "string" ? JSON.parse(r.sources) : r.sources ?? []) as WebSourceItem[],
  version: Number(r.version),
  projectId: r.project_id,
  updatedAt: iso(r.updated_at),
});

/** Who can reach a document: in a project, anyone on it; outside projects, only the person who made it. */
function scope(projectId: string | null, userId: string, from = 3) {
  return projectId ? { where: `project_id = $${from}`, param: projectId } : { where: `project_id IS NULL AND user_id = $${from}`, param: userId };
}

export async function createDocument(
  db: Db,
  workspaceId: string,
  projectId: string | null,
  input: { userId: string; title: string; content: string; kind?: "document" | "research"; sources?: WebSourceItem[]; messageId?: string }
): Promise<ChatDocument> {
  const [row] = await db.query<Row>(
    `INSERT INTO chat_documents (workspace_id, project_id, user_id, kind, title, content, sources, message_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8) RETURNING id, kind, title, content, sources, version, project_id, updated_at`,
    [
      workspaceId,
      projectId,
      input.userId,
      input.kind ?? "document",
      input.title.trim().slice(0, 200) || "Untitled",
      input.content.slice(0, MAX_DOCUMENT_CHARS),
      JSON.stringify(input.sources ?? []),
      input.messageId ?? null,
    ]
  );
  return view(row);
}

export async function getDocument(db: Db, workspaceId: string, projectId: string | null, userId: string, id: string): Promise<ChatDocument | null> {
  const s = scope(projectId, userId);
  const [row] = await db.query<Row>(
    `SELECT id, kind, title, content, sources, version, project_id, updated_at FROM chat_documents WHERE workspace_id = $1 AND id = $2 AND ${s.where}`,
    [workspaceId, id, s.param]
  );
  return row ? view(row) : null;
}

/**
 * Saves new text (and title), keeping the text before it as a version.
 * `expectedVersion` refuses the save when someone else saved in between, so
 * neither the assistant nor she overwrites the other unseen. Returns null when
 * the document is gone, "conflict" when it moved on.
 */
export async function saveDocument(
  db: Db,
  workspaceId: string,
  projectId: string | null,
  userId: string,
  id: string,
  input: { title?: string; content?: string; expectedVersion?: number }
): Promise<ChatDocument | null | "conflict"> {
  const current = await getDocument(db, workspaceId, projectId, userId, id);
  if (!current) return null;
  if (input.expectedVersion !== undefined && input.expectedVersion !== current.version) return "conflict";
  const title = input.title !== undefined ? input.title.trim().slice(0, 200) || "Untitled" : current.title;
  const content = input.content !== undefined ? input.content.slice(0, MAX_DOCUMENT_CHARS) : current.content;
  if (title === current.title && content === current.content) return current;
  await db.query(
    `INSERT INTO chat_document_versions (document_id, version, title, content, saved_by) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
    [id, current.version, current.title, current.content, userId]
  );
  const [row] = await db.query<Row>(
    `UPDATE chat_documents SET title = $3, content = $4, version = version + 1, updated_at = NOW()
     WHERE workspace_id = $1 AND id = $2 AND version = $5 RETURNING id, kind, title, content, sources, version, project_id, updated_at`,
    [workspaceId, id, title, content, current.version]
  );
  return row ? view(row) : "conflict";
}

export async function listVersions(db: Db, workspaceId: string, projectId: string | null, userId: string, id: string): Promise<ChatDocumentVersion[]> {
  if (!(await getDocument(db, workspaceId, projectId, userId, id))) return [];
  const rows = await db.query<{ version: number; title: string; created_at: Date | string }>(
    "SELECT version, title, created_at FROM chat_document_versions WHERE document_id = $1 ORDER BY version DESC LIMIT 50",
    [id]
  );
  return rows.map((r) => ({ version: Number(r.version), title: r.title, savedAt: iso(r.created_at) }));
}

/** Puts an earlier version's text back, as a new version (so going back can be undone too). */
export async function restoreVersion(
  db: Db,
  workspaceId: string,
  projectId: string | null,
  userId: string,
  id: string,
  version: number
): Promise<ChatDocument | null | "conflict"> {
  if (!(await getDocument(db, workspaceId, projectId, userId, id))) return null;
  const [old] = await db.query<{ title: string; content: string }>("SELECT title, content FROM chat_document_versions WHERE document_id = $1 AND version = $2", [id, version]);
  if (!old) return null;
  return saveDocument(db, workspaceId, projectId, userId, id, { title: old.title, content: old.content });
}
