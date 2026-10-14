import { z } from "zod";
import type { Db } from "@/lib/db";
import { autopilotLevels, cadenceHours, CADENCES, DEFAULT_LEVELS, type AutopilotLevels, type Cadence } from "./model";

/**
 * The autopilot as stored: its settings per project, its runs, and what it
 * asked the designer with her answers.
 */

export interface AutopilotState {
  enabled: boolean;
  paused: boolean;
  cadence: Cadence;
  levels: AutopilotLevels;
  runAs: string | null;
  lastRunAt: string | null;
  nextRunAt: string | null;
  nextReason: string | null;
  running: boolean;
}

export const OFF: AutopilotState = {
  enabled: false,
  paused: false,
  cadence: "daily",
  levels: DEFAULT_LEVELS,
  runAs: null,
  lastRunAt: null,
  nextRunAt: null,
  nextReason: null,
  running: false,
};

/** A run counts as still going for this long; after it the lock is taken over. */
const LOCK_MINUTES = 15;

const iso = (v: unknown) => (v == null ? null : new Date(v as string).toISOString());
const json = <T>(v: unknown): T => (typeof v === "string" ? (JSON.parse(v) as T) : (v as T));

interface Row {
  enabled: boolean;
  paused: boolean;
  cadence: string;
  settings: unknown;
  run_as: string | null;
  last_run_at: unknown;
  next_run_at: unknown;
  next_reason: string | null;
  running_since: unknown;
}

function toState(row: Row | undefined): AutopilotState {
  if (!row) return OFF;
  const parsed = autopilotLevels.safeParse(json(row.settings) ?? {});
  const running = !!row.running_since && Date.now() - new Date(row.running_since as string).getTime() < LOCK_MINUTES * 60_000;
  return {
    enabled: row.enabled,
    paused: row.paused,
    cadence: (CADENCES as readonly string[]).includes(row.cadence) ? (row.cadence as Cadence) : "daily",
    levels: parsed.success ? parsed.data : DEFAULT_LEVELS,
    runAs: row.run_as,
    lastRunAt: iso(row.last_run_at),
    nextRunAt: iso(row.next_run_at),
    nextReason: row.next_reason,
    running,
  };
}

export async function getAutopilot(db: Db, projectId: string): Promise<AutopilotState> {
  const [row] = await db.query<Row>("SELECT * FROM project_autopilot WHERE project_id = $1", [projectId]);
  return toState(row);
}

export const autopilotPatch = z.object({
  enabled: z.boolean().optional(),
  paused: z.boolean().optional(),
  cadence: z.enum(CADENCES).optional(),
  levels: autopilotLevels.optional(),
});
export type AutopilotPatch = z.infer<typeof autopilotPatch>;

/**
 * Changes the settings. Turning it on (or resuming) makes the person who did
 * it the one it acts as, and has it look straight away.
 */
export async function saveAutopilot(db: Db, workspaceId: string, projectId: string, userId: string, patch: AutopilotPatch): Promise<AutopilotState> {
  const before = await getAutopilot(db, projectId);
  const next = {
    enabled: patch.enabled ?? before.enabled,
    paused: patch.paused ?? before.paused,
    cadence: patch.cadence ?? before.cadence,
    levels: patch.levels ?? before.levels,
  };
  const startsNow = (next.enabled && !before.enabled) || (before.paused && !next.paused);
  await db.query(
    `INSERT INTO project_autopilot (project_id, workspace_id, enabled, paused, cadence, settings, run_as, next_run_at, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, CASE WHEN $8 THEN NOW() END, $7, NOW())
     ON CONFLICT (project_id) DO UPDATE SET
       enabled = EXCLUDED.enabled, paused = EXCLUDED.paused, cadence = EXCLUDED.cadence, settings = EXCLUDED.settings,
       run_as = CASE WHEN $8 OR project_autopilot.run_as IS NULL THEN EXCLUDED.run_as ELSE project_autopilot.run_as END,
       next_run_at = CASE WHEN $8 THEN NOW() ELSE project_autopilot.next_run_at END,
       updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [projectId, workspaceId, next.enabled, next.enabled ? next.paused : false, next.cadence, JSON.stringify(next.levels), userId, startsNow]
  );
  return getAutopilot(db, projectId);
}

/** Takes the run lock; false when a run is already going. */
export async function claimRun(db: Db, projectId: string): Promise<boolean> {
  const rows = await db.query(
    `UPDATE project_autopilot SET running_since = NOW()
     WHERE project_id = $1 AND (running_since IS NULL OR running_since < NOW() - INTERVAL '${LOCK_MINUTES} minutes') RETURNING project_id`,
    [projectId]
  );
  return rows.length > 0;
}

/** Releases the lock and sets when it looks next: when the run asked for, else on its cadence. */
export async function releaseRun(db: Db, projectId: string, next: { at: Date | null; reason: string | null }): Promise<void> {
  await db.query(
    "UPDATE project_autopilot SET running_since = NULL, last_run_at = NOW(), next_run_at = $2, next_reason = $3 WHERE project_id = $1",
    [projectId, next.at?.toISOString() ?? null, next.reason]
  );
}

export function nextOnCadence(cadence: Cadence, from = new Date()): Date | null {
  const hours = cadenceHours(cadence);
  return hours == null ? null : new Date(from.getTime() + hours * 3_600_000);
}

/** Scheduled and visit runs started on this project in the last day. */
export async function runsToday(db: Db, projectId: string): Promise<number> {
  const [row] = await db.query<{ n: string | number }>(
    "SELECT COUNT(*) AS n FROM autopilot_runs WHERE project_id = $1 AND trigger <> 'manual' AND status <> 'idle' AND started_at > NOW() - INTERVAL '1 day'",
    [projectId]
  );
  return Number(row?.n ?? 0);
}

/** Projects whose autopilot is due a look, oldest due first. */
export async function dueProjects(db: Db, limit: number, workspaceId?: string): Promise<{ workspaceId: string; projectId: string; slug: string; runAs: string }[]> {
  const rows = await db.query<{ workspace_id: string; project_id: string; slug: string; run_as: string }>(
    `SELECT a.workspace_id, a.project_id, p.slug, a.run_as FROM project_autopilot a JOIN projects p ON p.id = a.project_id
     WHERE a.enabled AND NOT a.paused AND a.run_as IS NOT NULL AND a.next_run_at IS NOT NULL AND a.next_run_at <= NOW()
       AND p.status = 'active' AND (a.running_since IS NULL OR a.running_since < NOW() - INTERVAL '${LOCK_MINUTES} minutes')
       ${workspaceId ? "AND a.workspace_id = $2" : ""}
     ORDER BY a.next_run_at LIMIT $1`,
    workspaceId ? [limit, workspaceId] : [limit]
  );
  return rows.map((r) => ({ workspaceId: r.workspace_id, projectId: r.project_id, slug: r.slug, runAs: r.run_as }));
}

// ---------------------------------------------------------------- runs

export type RunTrigger = "manual" | "answer" | "schedule" | "visit";

export interface RunView {
  id: string;
  trigger: RunTrigger;
  status: "running" | "done" | "idle" | "failed";
  summary: string;
  messageId: string | null;
  applied: number;
  review: number;
  asked: number;
  startedAt: string;
  finishedAt: string | null;
}

export async function startRun(db: Db, workspaceId: string, projectId: string, userId: string, trigger: RunTrigger): Promise<string> {
  const [row] = await db.query<{ id: string }>(
    "INSERT INTO autopilot_runs (workspace_id, project_id, user_id, trigger) VALUES ($1, $2, $3, $4) RETURNING id",
    [workspaceId, projectId, userId, trigger]
  );
  return row.id;
}

export async function finishRun(
  db: Db,
  runId: string,
  out: { status: RunView["status"]; summary: string; messageId?: string | null; applied?: number; review?: number; asked?: number }
): Promise<void> {
  await db.query(
    `UPDATE autopilot_runs SET status = $2, summary = $3, message_id = COALESCE($4, message_id), applied = $5, review = $6, asked = $7, finished_at = NOW() WHERE id = $1`,
    [runId, out.status, out.summary.slice(0, 4000), out.messageId ?? null, out.applied ?? 0, out.review ?? 0, out.asked ?? 0]
  );
}

export async function listRuns(db: Db, projectId: string, limit = 20): Promise<RunView[]> {
  const rows = await db.query<Record<string, unknown>>(
    "SELECT * FROM autopilot_runs WHERE project_id = $1 ORDER BY started_at DESC LIMIT $2",
    [projectId, limit]
  );
  return rows.map((r) => ({
    id: String(r.id),
    trigger: r.trigger as RunTrigger,
    status: r.status as RunView["status"],
    summary: String(r.summary ?? ""),
    messageId: (r.message_id as string) ?? null,
    applied: Number(r.applied),
    review: Number(r.review),
    asked: Number(r.asked),
    startedAt: iso(r.started_at)!,
    finishedAt: iso(r.finished_at),
  }));
}

/** What the last few runs said, for the next one to carry on from. */
export async function recentSummaries(db: Db, projectId: string, n = 3): Promise<string[]> {
  const rows = await db.query<{ summary: string; started_at: unknown }>(
    "SELECT summary, started_at FROM autopilot_runs WHERE project_id = $1 AND status = 'done' AND summary <> '' ORDER BY started_at DESC LIMIT $2",
    [projectId, n]
  );
  return rows.reverse().map((r) => `${iso(r.started_at)!.slice(0, 10)}: ${r.summary.replace(/\s+/g, " ").slice(0, 600)}`);
}

// ---------------------------------------------------------------- asks

export const ASK_KINDS = ["question", "choice", "file", "approval", "message", "document"] as const;
export type AskKind = (typeof ASK_KINDS)[number];

export interface AskFile {
  documentId: string;
  name: string;
}

export interface AskView {
  id: string;
  projectId: string;
  kind: AskKind;
  title: string;
  detail: string;
  options: string[];
  draft: string | null;
  /** Where to open what it is about, e.g. a drafted invoice. */
  link: string | null;
  phaseKey: string | null;
  stepItemId: string | null;
  urgent: boolean;
  status: "open" | "answered" | "dismissed";
  answer: string | null;
  files: AskFile[];
  createdAt: string;
  answeredAt: string | null;
}

function toAsk(r: Record<string, unknown>): AskView {
  return {
    id: String(r.id),
    projectId: String(r.project_id),
    kind: r.kind as AskKind,
    title: String(r.title),
    detail: String(r.detail ?? ""),
    options: json<string[]>(r.options) ?? [],
    draft: (r.draft as string) ?? null,
    link: (r.link as string) ?? null,
    phaseKey: (r.phase_key as string) ?? null,
    stepItemId: (r.step_item_id as string) ?? null,
    urgent: !!r.urgent,
    status: r.status as AskView["status"],
    answer: (r.answer as string) ?? null,
    files: json<AskFile[]>(r.answer_files) ?? [],
    createdAt: iso(r.created_at)!,
    answeredAt: iso(r.answered_at),
  };
}

export interface NewAsk {
  kind: AskKind;
  title: string;
  detail?: string;
  options?: string[];
  draft?: string;
  link?: string;
  phaseKey?: string;
  stepItemId?: string;
  urgent?: boolean;
}

/** Adds a question; null when the same one is already open on the project. */
export async function createAsk(db: Db, workspaceId: string, projectId: string, runId: string | null, ask: NewAsk): Promise<AskView | null> {
  const [dupe] = await db.query("SELECT id FROM autopilot_asks WHERE project_id = $1 AND status = 'open' AND lower(title) = lower($2)", [projectId, ask.title]);
  if (dupe) return null;
  const [row] = await db.query<Record<string, unknown>>(
    `INSERT INTO autopilot_asks (workspace_id, project_id, run_id, kind, title, detail, options, draft, phase_key, step_item_id, urgent, link)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12) RETURNING *`,
    [
      workspaceId,
      projectId,
      runId,
      ask.kind,
      ask.title.slice(0, 500),
      (ask.detail ?? "").slice(0, 4000),
      JSON.stringify(ask.options ?? []),
      ask.draft ?? null,
      ask.phaseKey ?? null,
      ask.stepItemId ?? null,
      !!ask.urgent,
      ask.link ?? null,
    ]
  );
  return toAsk(row);
}

export async function getAsk(db: Db, workspaceId: string, askId: string): Promise<AskView | null> {
  if (!/^[0-9a-f-]{36}$/i.test(askId)) return null;
  const [row] = await db.query<Record<string, unknown>>("SELECT * FROM autopilot_asks WHERE workspace_id = $1 AND id = $2", [workspaceId, askId]);
  return row ? toAsk(row) : null;
}

export async function projectAsks(db: Db, projectId: string, status: AskView["status"] | "all" = "open", limit = 50): Promise<AskView[]> {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT * FROM autopilot_asks WHERE project_id = $1 ${status === "all" ? "" : "AND status = $3"} ORDER BY urgent DESC, created_at DESC LIMIT $2`,
    status === "all" ? [projectId, limit] : [projectId, limit, status]
  );
  return rows.map(toAsk);
}

/** Open asks on the given projects, for the inbox. */
export async function openAsksFor(db: Db, projectIds: string[]): Promise<AskView[]> {
  if (!projectIds.length) return [];
  const rows = await db.query<Record<string, unknown>>(
    "SELECT * FROM autopilot_asks WHERE project_id = ANY($1::uuid[]) AND status = 'open' ORDER BY urgent DESC, created_at DESC LIMIT 200",
    [projectIds]
  );
  return rows.map(toAsk);
}

/** Records her answer, or that she waved it away. False when it was already settled. */
export async function answerAsk(
  db: Db,
  askId: string,
  userId: string,
  out: { status: "answered" | "dismissed"; answer?: string; files?: AskFile[] }
): Promise<boolean> {
  const rows = await db.query(
    `UPDATE autopilot_asks SET status = $2, answer = $3, answer_files = $4::jsonb, answered_by = $5, answered_at = NOW()
     WHERE id = $1 AND status = 'open' RETURNING id`,
    [askId, out.status, out.answer?.slice(0, 8000) ?? null, JSON.stringify(out.files ?? []), userId]
  );
  return rows.length > 0;
}

/** Answers no run has read yet. */
export async function unreadAnswers(db: Db, projectId: string): Promise<AskView[]> {
  const rows = await db.query<Record<string, unknown>>(
    "SELECT * FROM autopilot_asks WHERE project_id = $1 AND status = 'answered' AND used_at IS NULL ORDER BY answered_at",
    [projectId]
  );
  return rows.map(toAsk);
}

export async function markAnswersRead(db: Db, askIds: string[]): Promise<void> {
  if (askIds.length) await db.query("UPDATE autopilot_asks SET used_at = NOW() WHERE id = ANY($1::uuid[])", [askIds]);
}

/** When it last drafted a client update for this project. */
export async function lastClientUpdate(db: Db, projectId: string): Promise<string | null> {
  const [row] = await db.query<{ at: unknown }>("SELECT MAX(created_at) AS at FROM autopilot_asks WHERE project_id = $1 AND kind = 'message'", [projectId]);
  return iso(row?.at);
}

/** Approvals, change requests and comments the client left on this project's shared links since a time. */
export async function clientFeedback(db: Db, projectId: string, since: string): Promise<import("./model").ClientFeedback[]> {
  const rows = await db.query<{ kind: string; title: string | null; phase_key: string | null; author: string; note: string }>(
    `SELECT * FROM (
       SELECT a.decision AS kind, s.title, s.phase_key, a.author_name AS author, a.note, a.created_at
       FROM share_approvals a JOIN share_links s ON s.id = a.share_id
       WHERE s.project_id = $1 AND a.created_at > $2
       UNION ALL
       SELECT 'comment', s.title, s.phase_key, c.author_name, c.body, c.created_at
       FROM share_comments c JOIN share_links s ON s.id = c.share_id
       WHERE s.project_id = $1 AND c.created_at > $2 AND c.internal = FALSE
     ) f ORDER BY created_at LIMIT 10`,
    [projectId, since]
  );
  return rows.map((r) => ({
    kind: r.kind === "approved" ? "approved" : r.kind === "changes_requested" ? "changes_requested" : "comment",
    title: r.title || "the shared work",
    phaseKey: r.phase_key,
    author: r.author,
    note: r.note ?? "",
  }));
}
