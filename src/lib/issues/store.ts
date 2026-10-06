import type { Db } from "@/lib/db";
import type { IssueReport, IssueStatus } from "@/lib/studio/types";

/**
 * Issue reports (P1-18) and the Admin's ticket queue (P1-19). A reporter sees
 * and changes only their own reports; the queue is the Admin's view of every
 * report across workspaces.
 */

export interface IssueRow {
  id: string;
  module_key: string;
  project_slug: string | null;
  page_url: string;
  note: string;
  status: IssueStatus;
  admin_note: string;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface Ticket extends IssueReport {
  reporter: { name: string | null; email: string };
  workspace: string;
  projectName?: string;
}

const iso = (d: Date | string) => new Date(d).toISOString();

function toIssue(r: IssueRow): IssueReport {
  return {
    id: r.id,
    moduleKey: r.module_key,
    ...(r.project_slug ? { projectId: r.project_slug } : {}),
    note: r.note,
    path: r.page_url,
    status: r.status,
    ...(r.admin_note ? { adminNote: r.admin_note } : {}),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

const ISSUE_COLUMNS = `i.id, i.module_key, p.slug AS project_slug, i.page_url, i.note, i.status, i.admin_note, i.created_at, i.updated_at`;

export interface NewIssue {
  moduleKey: string;
  note: string;
  path: string;
  /** The project's id as the app shows it (its slug). Ignored when it is not in the workspace. */
  projectId?: string;
}

export async function createIssue(db: Db, workspaceId: string, userId: string, input: NewIssue): Promise<IssueReport> {
  const rows = await db.query<IssueRow>(
    `WITH created AS (
       INSERT INTO issue_reports (workspace_id, user_id, module_key, page_url, note, project_id)
       VALUES ($1, $2, $3, $4, $5,
               (SELECT id FROM projects WHERE workspace_id = $1 AND slug = $6))
       RETURNING *
     )
     SELECT ${ISSUE_COLUMNS} FROM created i LEFT JOIN projects p ON p.id = i.project_id`,
    [workspaceId, userId, input.moduleKey, input.path, input.note, input.projectId ?? null]
  );
  return toIssue(rows[0]);
}

/** The reporter's own reports that are not closed, newest first. */
export async function listMyIssues(db: Db, workspaceId: string, userId: string): Promise<IssueReport[]> {
  const rows = await db.query<IssueRow>(
    `SELECT ${ISSUE_COLUMNS} FROM issue_reports i LEFT JOIN projects p ON p.id = i.project_id
     WHERE i.workspace_id = $1 AND i.user_id = $2 AND i.status <> 'closed'
     ORDER BY i.created_at DESC`,
    [workspaceId, userId]
  );
  return rows.map(toIssue);
}

export type MyIssueChange = { note: string } | { close: true };

/** Edits or closes one of the reporter's own reports; null when it is not theirs. */
export async function updateMyIssue(
  db: Db,
  workspaceId: string,
  userId: string,
  issueId: string,
  change: MyIssueChange
): Promise<IssueReport | null> {
  const set = "close" in change ? `status = 'closed'` : `note = $4`;
  const params = [workspaceId, userId, issueId, ...("close" in change ? [] : [change.note])];
  const rows = await db.query<IssueRow>(
    `WITH changed AS (
       UPDATE issue_reports SET ${set}, updated_at = NOW(), updated_by = $2
       WHERE id = $3 AND workspace_id = $1 AND user_id = $2 AND status <> 'closed'
       RETURNING *
     )
     SELECT ${ISSUE_COLUMNS} FROM changed i LEFT JOIN projects p ON p.id = i.project_id`,
    params
  );
  return rows[0] ? toIssue(rows[0]) : null;
}

interface TicketRow extends IssueRow {
  reporter_name: string | null;
  reporter_email: string;
  workspace_name: string;
  project_name: string | null;
}

function toTicket(r: TicketRow): Ticket {
  return {
    ...toIssue(r),
    reporter: { name: r.reporter_name, email: r.reporter_email },
    workspace: r.workspace_name,
    ...(r.project_name ? { projectName: r.project_name } : {}),
  };
}

const TICKET_QUERY = `
  SELECT ${ISSUE_COLUMNS}, u.name AS reporter_name, u.email AS reporter_email,
         w.name AS workspace_name, p.name AS project_name
  FROM issue_reports i
  JOIN users u ON u.id = i.user_id
  JOIN workspaces w ON w.id = i.workspace_id
  LEFT JOIN projects p ON p.id = i.project_id`;

/** Every report on the platform, newest first, for the Admin. */
export async function listTickets(db: Db, limit = 500): Promise<Ticket[]> {
  const rows = await db.query<TicketRow>(`${TICKET_QUERY} ORDER BY i.created_at DESC LIMIT $1`, [limit]);
  return rows.map(toTicket);
}

export interface TicketChange {
  status?: Exclude<IssueStatus, "closed">;
  adminNote?: string;
}

/** The Admin moves a ticket along or replies on it; null when there is no such ticket. */
export async function updateTicket(db: Db, adminId: string, ticketId: string, change: TicketChange): Promise<Ticket | null> {
  const updated = await db.query<{ id: string }>(
    `UPDATE issue_reports
     SET status = COALESCE($3, status), admin_note = COALESCE($4, admin_note), updated_at = NOW(), updated_by = $2
     WHERE id = $1
     RETURNING id`,
    [ticketId, adminId, change.status ?? null, change.adminNote ?? null]
  );
  if (!updated[0]) return null;
  const rows = await db.query<TicketRow>(`${TICKET_QUERY} WHERE i.id = $1`, [ticketId]);
  return rows[0] ? toTicket(rows[0]) : null;
}
