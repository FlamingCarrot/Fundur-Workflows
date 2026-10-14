import type { Db } from "@/lib/db";
import { parseAction, type AssistantAction } from "./actions";
import type { ProposalDraft } from "./tools/registry";
import type { ChatCard } from "./chat-items";

/**
 * The project chat as stored (P4-10): one conversation per project, what the
 * assistant did in each reply, and the changes it made or proposed with their
 * status. Usage is shown in tokens; the Admin also sees each call's model and
 * cost, and the tools it ran.
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
  | { type: "error"; text: string }
  /** On her message: what she was pointing at when she sent it, e.g. "2 desks". */
  | { type: "context"; text: string }
  /** On a reply the autopilot wrote on its own, not in answer to her. */
  | { type: "autopilot"; runId: string }
  /** A blueprint it saved, which the chat offers to open. */
  | { type: "blueprint"; id: string; name: string }
  /** A smart chat item: a link, image, file, document or research report. */
  | { type: "card"; card: ChatCard };

export type ProposalStatus = "pending" | "applied" | "dismissed" | "undone";

export interface ProposalView {
  id: string;
  summary: string;
  kind: AssistantAction["type"];
  status: ProposalStatus;
  /** Applied straight away rather than confirmed. */
  direct: boolean;
  /** Can still be taken back with Undo. */
  undoable: boolean;
}

/** One AI call behind a reply, as the Admin sees it. */
export interface RunLine {
  model: string;
  provider: string;
  role: string;
  task: string;
  inputTokens: number;
  outputTokens: number;
  costZar: number;
  costUsd: number;
  fallback: boolean;
  ok: boolean;
}

/** One tool the assistant ran for a reply. */
export interface ToolRunLine {
  name: string;
  ok: boolean;
  durationMs: number;
}

export interface ChatMessageView {
  id: string;
  role: "user" | "assistant";
  content: string;
  attachments: ChatAttachment[];
  events: ChatEvent[];
  proposals: ProposalView[];
  /** What the reply cost: the sum of the AI calls logged against it. Zero for anyone but the Admin. */
  costZar: number;
  /** Tokens the reply's calls read and wrote. */
  tokens: { input: number; output: number };
  /** The Admin's breakdown: every call with its model and cost, and every tool run. */
  breakdown?: { runs: RunLine[]; tools: ToolRunLine[] };
  /**
   * Changes made by replies this message replaced (she edited it or asked
   * again) that are still in place and can be undone.
   */
  kept?: ProposalView[];
  /** Written by the person viewing, who can edit it or ask for its reply again. */
  mine: boolean;
  createdAt: string;
}

const iso = (v: Date | string) => new Date(v).toISOString();
const asArray = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : typeof v === "string" ? (JSON.parse(v) as T[]) : []);

export async function addMessage(
  db: Db,
  workspaceId: string,
  /** Null for her own conversation outside any project. */
  projectId: string | null,
  input: { userId: string; role: "user" | "assistant"; content: string; attachments?: ChatAttachment[]; events?: ChatEvent[] }
): Promise<string> {
  const [row] = await db.query<{ id: string }>(
    `INSERT INTO ai_chat_messages (workspace_id, project_id, user_id, role, content, attachments, events)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb) RETURNING id`,
    [workspaceId, projectId, input.userId, input.role, input.content, JSON.stringify(input.attachments ?? []), JSON.stringify(input.events ?? [])]
  );
  return row.id;
}

/** Logs one tool run for the Admin's breakdown. */
export async function logToolCall(
  db: Db,
  workspaceId: string,
  projectId: string | null,
  messageId: string,
  call: { name: string; ok: boolean; durationMs: number }
): Promise<void> {
  await db.query(
    `INSERT INTO ai_tool_calls (workspace_id, project_id, chat_message_id, tool_name, ok, duration_ms) VALUES ($1, $2, $3, $4, $5, $6)`,
    [workspaceId, projectId, messageId, call.name.slice(0, 100), call.ok, Math.max(0, Math.round(call.durationMs))]
  );
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
  projectId: string | null,
  messageId: string,
  draft: ProposalDraft,
  /** Set when the change was already applied: the change that takes it back. */
  applied?: { undo: unknown; userId: string }
): Promise<ProposalView> {
  const [row] = await db.query<{ id: string }>(
    `INSERT INTO ai_proposals (workspace_id, project_id, message_id, summary, mutation, status, direct, undo, resolved_at, resolved_by)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8::jsonb, CASE WHEN $7 THEN NOW() END, $9) RETURNING id`,
    [
      workspaceId,
      projectId,
      messageId,
      draft.summary,
      JSON.stringify(draft.mutation),
      applied ? "applied" : "pending",
      !!applied,
      applied?.undo != null ? JSON.stringify(applied.undo) : null,
      applied?.userId ?? null,
    ]
  );
  return {
    id: row.id,
    summary: draft.summary,
    kind: draft.mutation.type,
    status: applied ? "applied" : "pending",
    direct: !!applied,
    undoable: applied?.undo != null,
  };
}

/** The pending proposal and its change, or null when there is none by that id on this project. */
export async function pendingProposal(
  db: Db,
  workspaceId: string,
  projectId: string,
  proposalId: string
): Promise<{ id: string; mutation: AssistantAction } | null> {
  const [row] = await db.query<{ id: string; mutation: unknown }>(
    "SELECT id, mutation FROM ai_proposals WHERE workspace_id = $1 AND project_id = $2 AND id = $3 AND status = 'pending'",
    [workspaceId, projectId, proposalId]
  );
  if (!row) return null;
  const mutation = parseAction(row.mutation);
  return mutation ? { id: row.id, mutation } : null;
}

/** A change that was applied and can be undone: what it was and what takes it back. */
export async function undoableProposal(
  db: Db,
  workspaceId: string,
  projectId: string,
  proposalId: string
): Promise<{ id: string; mutation: AssistantAction; undo: unknown } | null> {
  const [row] = await db.query<{ id: string; mutation: unknown; undo: unknown }>(
    `SELECT id, mutation, undo FROM ai_proposals
     WHERE workspace_id = $1 AND project_id = $2 AND id = $3 AND status = 'applied' AND undo IS NOT NULL`,
    [workspaceId, projectId, proposalId]
  );
  if (!row) return null;
  const mutation = parseAction(row.mutation);
  return mutation ? { id: row.id, mutation, undo: typeof row.undo === "string" ? JSON.parse(row.undo) : row.undo } : null;
}

/** Marks an applied change undone; false when it was not applied (or already undone). */
export async function markUndone(db: Db, workspaceId: string, proposalId: string, userId: string): Promise<boolean> {
  const rows = await db.query(
    `UPDATE ai_proposals SET status = 'undone', resolved_at = NOW(), resolved_by = $3
     WHERE workspace_id = $1 AND id = $2 AND status = 'applied' RETURNING id`,
    [workspaceId, proposalId, userId]
  );
  return rows.length > 0;
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

/**
 * Replaces one of her messages and everything after it in the conversation,
 * for editing a message or asking for a reply again. The messages are kept,
 * with the changes their replies made, but are no longer shown or read back to
 * the model. Returns false when the message is not hers in this conversation,
 * or a teammate wrote after it.
 */
export async function replaceFrom(
  db: Db,
  workspaceId: string,
  /** Null with `userId` for her own conversation outside any project. */
  projectId: string | null,
  userId: string,
  messageId: string
): Promise<boolean> {
  const where = projectId ? "project_id = $2" : "project_id IS NULL AND user_id = $2";
  const [target] = await db.query<{ created_at: Date | string }>(
    `SELECT created_at FROM ai_chat_messages
     WHERE workspace_id = $1 AND ${where} AND id = $3 AND role = 'user' AND user_id = $4 AND replaced_at IS NULL`,
    [workspaceId, projectId ?? userId, messageId, userId]
  );
  if (!target) return false;
  // A teammate's later message in a project's conversation is never taken away.
  const [other] = await db.query<{ id: string }>(
    `SELECT id FROM ai_chat_messages
     WHERE workspace_id = $1 AND ${where} AND created_at >= $3 AND replaced_at IS NULL AND role = 'user' AND user_id IS DISTINCT FROM $4 LIMIT 1`,
    [workspaceId, projectId ?? userId, target.created_at, userId]
  );
  if (other) return false;
  const hidden = await db.query<{ id: string }>(
    `UPDATE ai_chat_messages SET replaced_at = NOW()
     WHERE workspace_id = $1 AND ${where} AND created_at >= $3 AND replaced_at IS NULL RETURNING id`,
    [workspaceId, projectId ?? userId, target.created_at]
  );
  // Changes the replaced replies only proposed no longer wait for her.
  await db.query(
    `UPDATE ai_proposals SET status = 'dismissed', resolved_at = NOW(), resolved_by = $3
     WHERE workspace_id = $1 AND message_id = ANY($2::uuid[]) AND status = 'pending'`,
    [workspaceId, hidden.map((h) => h.id), userId]
  );
  return true;
}

/** The latest messages, oldest first, with their proposals, tokens and (for the Admin) costs and breakdown. */
export async function listMessages(
  db: Db,
  workspaceId: string,
  /** Null with `opts.userId` for her own conversation outside any project. */
  projectId: string | null,
  limit = 100,
  opts: { isAdmin?: boolean; userId?: string; viewerId?: string } = {}
): Promise<ChatMessageView[]> {
  if (!projectId && !opts.userId) return [];
  const rows = await db.query<{
    id: string;
    role: "user" | "assistant";
    user_id: string | null;
    content: string;
    attachments: unknown;
    events: unknown;
    created_at: Date | string;
    cost_zar: string | number;
    input_tokens: string | number;
    output_tokens: string | number;
  }>(
    `SELECT * FROM (
       SELECT m.id, m.role, m.user_id, m.content, m.attachments, m.events, m.created_at,
         (SELECT COALESCE(SUM(r.cost_zar), 0) FROM ai_runs r WHERE r.chat_message_id = m.id) AS cost_zar,
         (SELECT COALESCE(SUM(r.prompt_tokens), 0) FROM ai_runs r WHERE r.chat_message_id = m.id) AS input_tokens,
         (SELECT COALESCE(SUM(r.completion_tokens), 0) FROM ai_runs r WHERE r.chat_message_id = m.id) AS output_tokens
       FROM ai_chat_messages m WHERE m.workspace_id = $1 AND ${projectId ? "m.project_id = $2" : "m.project_id IS NULL AND m.user_id = $2"}
         AND m.replaced_at IS NULL
       ORDER BY m.created_at DESC, m.id DESC LIMIT $3
     ) latest ORDER BY created_at, id`,
    [workspaceId, projectId ?? opts.userId, limit]
  );
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const proposals = await db.query<{ id: string; message_id: string; summary: string; mutation: unknown; status: ProposalStatus; direct: boolean; has_undo: boolean }>(
    `SELECT id, message_id, summary, mutation, status, direct, undo IS NOT NULL AS has_undo FROM ai_proposals
     WHERE workspace_id = $1 AND message_id = ANY($2::uuid[]) ORDER BY created_at, id`,
    [workspaceId, ids]
  );
  // Changes from replaced replies that can still be undone show on the message that replaced them.
  const kept = await db.query<{ id: string; summary: string; mutation: unknown; direct: boolean; created_at: Date | string }>(
    `SELECT p.id, p.summary, p.mutation, p.direct, m.created_at FROM ai_proposals p JOIN ai_chat_messages m ON m.id = p.message_id
     WHERE p.workspace_id = $1 AND p.status = 'applied' AND p.undo IS NOT NULL AND m.replaced_at IS NOT NULL
       AND ${projectId ? "m.project_id = $2" : "m.project_id IS NULL AND m.user_id = $2"} AND m.created_at >= $3
     ORDER BY p.created_at, p.id`,
    [workspaceId, projectId ?? opts.userId, rows[0].created_at]
  );
  const keptOn = new Map<string, ProposalView[]>();
  for (const k of kept) {
    const after = rows.find((r) => new Date(r.created_at).getTime() > new Date(k.created_at).getTime() && r.role === "user");
    if (!after) continue;
    const m = (typeof k.mutation === "string" ? JSON.parse(k.mutation) : k.mutation) as { type: AssistantAction["type"] };
    keptOn.set(after.id, [...(keptOn.get(after.id) ?? []), { id: k.id, summary: k.summary, kind: m.type, status: "applied", direct: !!k.direct, undoable: true }]);
  }
  const runs = opts.isAdmin
    ? await db.query<{
        chat_message_id: string;
        model_name: string;
        provider: string;
        role: string;
        task_name: string;
        prompt_tokens: number;
        completion_tokens: number;
        cost_zar: string | number;
        cost_usd: string | number;
        fallback: boolean;
        outcome: string;
      }>(
        `SELECT chat_message_id, model_name, provider, role, task_name, prompt_tokens, completion_tokens, cost_zar, cost_usd, fallback, outcome
         FROM ai_runs WHERE workspace_id = $1 AND chat_message_id = ANY($2::uuid[]) ORDER BY created_at, id`,
        [workspaceId, ids]
      )
    : [];
  const tools = opts.isAdmin
    ? await db.query<{ chat_message_id: string; tool_name: string; ok: boolean; duration_ms: number }>(
        `SELECT chat_message_id, tool_name, ok, duration_ms FROM ai_tool_calls
         WHERE workspace_id = $1 AND chat_message_id = ANY($2::uuid[]) ORDER BY created_at, id`,
        [workspaceId, ids]
      )
    : [];
  return rows.map((r) => ({
    id: r.id,
    role: r.role,
    content: r.content,
    attachments: asArray<ChatAttachment>(r.attachments),
    events: asArray<ChatEvent>(r.events),
    proposals: proposals
      .filter((p) => p.message_id === r.id)
      .map((p) => {
        const m = (typeof p.mutation === "string" ? JSON.parse(p.mutation) : p.mutation) as { type: AssistantAction["type"] };
        return { id: p.id, summary: p.summary, kind: m.type, status: p.status, direct: !!p.direct, undoable: p.status === "applied" && !!p.has_undo };
      }),
    costZar: opts.isAdmin ? Number(r.cost_zar) : 0,
    tokens: { input: Number(r.input_tokens), output: Number(r.output_tokens) },
    ...(opts.isAdmin && r.role === "assistant"
      ? {
          breakdown: {
            runs: runs
              .filter((x) => x.chat_message_id === r.id)
              .map((x) => ({
                model: x.model_name,
                provider: x.provider,
                role: x.role,
                task: x.task_name,
                inputTokens: Number(x.prompt_tokens),
                outputTokens: Number(x.completion_tokens),
                costZar: Number(x.cost_zar),
                costUsd: Number(x.cost_usd),
                fallback: !!x.fallback,
                ok: x.outcome === "success",
              })),
            tools: tools.filter((x) => x.chat_message_id === r.id).map((x) => ({ name: x.tool_name, ok: !!x.ok, durationMs: Number(x.duration_ms) })),
          },
        }
      : {}),
    ...(keptOn.has(r.id) ? { kept: keptOn.get(r.id) } : {}),
    mine: !!r.user_id && r.user_id === (opts.viewerId ?? opts.userId),
    createdAt: iso(r.created_at),
  }));
}
