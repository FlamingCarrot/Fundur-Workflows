import type { Db } from "@/lib/db";
import { projectMutation, type ProjectMutation } from "@/lib/projects/mutations";
import type { ProposalDraft } from "./tools/registry";

/**
 * The project chat as stored (P4-10): one conversation per project, what the
 * assistant did in each reply, and the changes it proposed with their status.
 */

export interface ChatAttachment {
  name: string;
  sizeBytes: number;
  contentType?: string;
  /** Where the browser uploaded it, inside this project's storage folder. */
  storageKey: string;
}

/** What the assistant did while answering, kept with its reply. */
export type ChatEvent =
  | { type: "tool"; name: string; label: string; ok: boolean; note?: string }
  | { type: "flag"; text: string }
  | { type: "error"; text: string };

export type ProposalStatus = "pending" | "applied" | "dismissed";

export interface ProposalView {
  id: string;
  summary: string;
  kind: ProjectMutation["type"];
  status: ProposalStatus;
}

export interface ChatMessageView {
  id: string;
  role: "user" | "assistant";
  content: string;
  attachments: ChatAttachment[];
  events: ChatEvent[];
  proposals: ProposalView[];
  /** What the reply cost: the sum of the AI calls logged against it. */
  costZar: number;
  createdAt: string;
}

const iso = (v: Date | string) => new Date(v).toISOString();
const asArray = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : typeof v === "string" ? (JSON.parse(v) as T[]) : []);

export async function addMessage(
  db: Db,
  workspaceId: string,
  projectId: string,
  input: { userId: string; role: "user" | "assistant"; content: string; attachments?: ChatAttachment[] }
): Promise<string> {
  const [row] = await db.query<{ id: string }>(
    `INSERT INTO ai_chat_messages (workspace_id, project_id, user_id, role, content, attachments)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb) RETURNING id`,
    [workspaceId, projectId, input.userId, input.role, input.content, JSON.stringify(input.attachments ?? [])]
  );
  return row.id;
}

export async function finishMessage(db: Db, messageId: string, content: string, events: ChatEvent[]): Promise<void> {
  await db.query("UPDATE ai_chat_messages SET content = $2, events = $3::jsonb WHERE id = $1", [
    messageId,
    content,
    JSON.stringify(events),
  ]);
}

export async function createProposal(
  db: Db,
  workspaceId: string,
  projectId: string,
  messageId: string,
  draft: ProposalDraft
): Promise<ProposalView> {
  const [row] = await db.query<{ id: string }>(
    `INSERT INTO ai_proposals (workspace_id, project_id, message_id, summary, mutation)
     VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING id`,
    [workspaceId, projectId, messageId, draft.summary, JSON.stringify(draft.mutation)]
  );
  return { id: row.id, summary: draft.summary, kind: draft.mutation.type, status: "pending" };
}

/** The pending proposal and its change, or null when there is none by that id on this project. */
export async function pendingProposal(
  db: Db,
  workspaceId: string,
  projectId: string,
  proposalId: string
): Promise<{ id: string; mutation: ProjectMutation } | null> {
  const [row] = await db.query<{ id: string; mutation: unknown }>(
    "SELECT id, mutation FROM ai_proposals WHERE workspace_id = $1 AND project_id = $2 AND id = $3 AND status = 'pending'",
    [workspaceId, projectId, proposalId]
  );
  if (!row) return null;
  const parsed = projectMutation.safeParse(typeof row.mutation === "string" ? JSON.parse(row.mutation) : row.mutation);
  return parsed.success ? { id: row.id, mutation: parsed.data } : null;
}

/** Marks a pending proposal applied or dismissed; false when it was already resolved. */
export async function resolveProposal(db: Db, workspaceId: string, proposalId: string, status: "applied" | "dismissed", userId: string) {
  const rows = await db.query(
    `UPDATE ai_proposals SET status = $3, resolved_at = NOW(), resolved_by = $4
     WHERE workspace_id = $1 AND id = $2 AND status = 'pending' RETURNING id`,
    [workspaceId, proposalId, status, userId]
  );
  return rows.length > 0;
}

/** The latest messages, oldest first, with their proposals and costs. */
export async function listMessages(db: Db, workspaceId: string, projectId: string, limit = 100): Promise<ChatMessageView[]> {
  const rows = await db.query<{
    id: string;
    role: "user" | "assistant";
    content: string;
    attachments: unknown;
    events: unknown;
    created_at: Date | string;
    cost_zar: string | number;
  }>(
    `SELECT * FROM (
       SELECT m.id, m.role, m.content, m.attachments, m.events, m.created_at,
         (SELECT COALESCE(SUM(r.cost_zar), 0) FROM ai_runs r WHERE r.chat_message_id = m.id) AS cost_zar
       FROM ai_chat_messages m WHERE m.workspace_id = $1 AND m.project_id = $2
       ORDER BY m.created_at DESC, m.id DESC LIMIT $3
     ) latest ORDER BY created_at, id`,
    [workspaceId, projectId, limit]
  );
  if (!rows.length) return [];
  const proposals = await db.query<{ id: string; message_id: string; summary: string; mutation: unknown; status: ProposalStatus }>(
    `SELECT id, message_id, summary, mutation, status FROM ai_proposals
     WHERE workspace_id = $1 AND message_id = ANY($2::uuid[]) ORDER BY created_at, id`,
    [workspaceId, rows.map((r) => r.id)]
  );
  return rows.map((r) => ({
    id: r.id,
    role: r.role,
    content: r.content,
    attachments: asArray<ChatAttachment>(r.attachments),
    events: asArray<ChatEvent>(r.events),
    proposals: proposals
      .filter((p) => p.message_id === r.id)
      .map((p) => {
        const m = (typeof p.mutation === "string" ? JSON.parse(p.mutation) : p.mutation) as { type: ProjectMutation["type"] };
        return { id: p.id, summary: p.summary, kind: m.type, status: p.status };
      }),
    costZar: Number(r.cost_zar),
    createdAt: iso(r.created_at),
  }));
}
