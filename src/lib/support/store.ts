import type { Db } from "@/lib/db";
import { messagesFor, type TicketMessage } from "@/lib/issues/store";
import type { IssueStatus } from "@/lib/studio/types";
import type { SupportRequest, SupportTopic } from "./types";

/**
 * Support requests: a person asks for help and talks it through with the
 * Admin. Each is a ticket in the Admin's queue (kind 'support'), next to the
 * issue reports, and only the person who asked sees it on their side.
 */

interface RequestRow {
  id: string;
  topic: string | null;
  subject: string | null;
  status: IssueStatus;
  created_at: Date | string;
  updated_at: Date | string;
  reporter_seen_at: Date | string | null;
}

const iso = (d: Date | string) => new Date(d).toISOString();

function toRequest(r: RequestRow, messages: TicketMessage[] = []): SupportRequest {
  const seen = r.reporter_seen_at ? new Date(r.reporter_seen_at).getTime() : 0;
  return {
    id: r.id,
    topic: (r.topic ?? "other") as SupportTopic,
    subject: r.subject ?? "",
    status: r.status,
    messages,
    unread: messages.some((m) => m.fromAdmin && new Date(m.createdAt).getTime() > seen),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

const COLUMNS = "id, topic, subject, status, created_at, updated_at, reporter_seen_at";

export interface NewSupportRequest {
  topic: SupportTopic;
  subject: string;
  message: string;
  path: string;
}

export async function createSupportRequest(
  db: Db,
  workspaceId: string,
  userId: string,
  input: NewSupportRequest
): Promise<SupportRequest> {
  const [row] = await db.query<RequestRow>(
    `INSERT INTO issue_reports (workspace_id, user_id, kind, module_key, topic, subject, page_url, note, reporter_seen_at)
     VALUES ($1, $2, 'support', 'support', $3, $4, $5, $6, NOW())
     RETURNING ${COLUMNS}`,
    [workspaceId, userId, input.topic, input.subject, input.path, input.message]
  );
  await db.query("INSERT INTO ticket_messages (ticket_id, author_id, from_admin, body) VALUES ($1, $2, FALSE, $3)", [
    row.id,
    userId,
    input.message,
  ]);
  return (await readMine(db, userId, row.id))!;
}

/** The person's own requests, the most recently active first. */
export async function listMySupport(db: Db, userId: string): Promise<SupportRequest[]> {
  const rows = await db.query<RequestRow>(
    `SELECT ${COLUMNS} FROM issue_reports WHERE user_id = $1 AND kind = 'support'
     ORDER BY updated_at DESC LIMIT 100`,
    [userId]
  );
  const messages = await messagesFor(db, rows.map((r) => r.id));
  return rows.map((r) => toRequest(r, messages.get(r.id)));
}

async function readMine(db: Db, userId: string, id: string): Promise<SupportRequest | null> {
  const [row] = await db.query<RequestRow>(
    `SELECT ${COLUMNS} FROM issue_reports WHERE id = $1 AND user_id = $2 AND kind = 'support'`,
    [id, userId]
  );
  if (!row) return null;
  return toRequest(row, (await messagesFor(db, [id])).get(id));
}

export type MySupportChange = { reply: string } | { close: true } | { seen: true };

/**
 * The person replies, closes the request, or marks the Admin's replies read.
 * A reply on a resolved request opens it again. Null when it is not theirs,
 * or is closed and they try to reply.
 */
export async function changeMySupport(
  db: Db,
  userId: string,
  id: string,
  change: MySupportChange
): Promise<SupportRequest | null> {
  const set =
    "reply" in change
      ? "status = CASE WHEN status = 'resolved' THEN 'open' ELSE status END, updated_at = NOW(), reporter_seen_at = NOW()"
      : "close" in change
        ? "status = 'closed', updated_at = NOW()"
        : "reporter_seen_at = NOW()";
  const guard = "seen" in change ? "" : "AND status <> 'closed'";
  const rows = await db.query(
    `UPDATE issue_reports SET ${set}, updated_by = $2
     WHERE id = $1 AND user_id = $2 AND kind = 'support' ${guard} RETURNING id`,
    [id, userId]
  );
  if (!rows.length) return null;
  if ("reply" in change) {
    await db.query("INSERT INTO ticket_messages (ticket_id, author_id, from_admin, body) VALUES ($1, $2, FALSE, $3)", [
      id,
      userId,
      change.reply,
    ]);
  }
  return readMine(db, userId, id);
}
