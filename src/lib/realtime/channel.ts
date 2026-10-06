import type { Db } from "@/lib/db";
import type { RealtimeEventPayload, RealtimeEventType } from "./bus";

/**
 * The shared live-sync channel.
 *
 * Each serverless instance holds its own in-memory bus, so two people are
 * usually served by different ones and never hear each other. Events are
 * written to the database instead, and every open stream reads what was added
 * since it last looked. Rows live a few minutes: they carry a change to
 * whoever is watching now, and the change itself is already saved on the
 * project.
 */

/** How long an event stays readable. Anything older is of no use to a stream that is behind. */
export const EVENT_TTL_MINUTES = 15;

/** How often a stream looks for new events, in milliseconds. */
export const POLL_MS = Number(process.env.REALTIME_POLL_MS) || 1500;

export interface PublishInput {
  workspaceId: string;
  projectId: string;
  type: RealtimeEventType;
  phaseKey?: string;
  origin?: string;
  data: unknown;
}

interface EventRow {
  id: string;
  type: RealtimeEventType;
  project_slug: string;
  phase_key: string | null;
  origin: string | null;
  data: unknown;
  created_at: Date | string;
}

function toEvent(row: EventRow, workspaceId: string): RealtimeEventPayload {
  return {
    id: `evt-${row.id}`,
    type: row.type,
    projectId: row.project_slug,
    workspaceId,
    ...(row.phase_key ? { phaseKey: row.phase_key } : {}),
    ...(row.origin ? { origin: row.origin } : {}),
    timestamp: new Date(row.created_at).toISOString(),
    data: row.data ?? {},
  };
}

export async function publishEvent(db: Db, input: PublishInput): Promise<RealtimeEventPayload> {
  const rows = await db.query<EventRow>(
    `INSERT INTO realtime_events (workspace_id, project_slug, type, phase_key, origin, data)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, type, project_slug, phase_key, origin, data, created_at`,
    [input.workspaceId, input.projectId, input.type, input.phaseKey ?? null, input.origin ?? null, JSON.stringify(input.data ?? {})]
  );
  return toEvent(rows[0], input.workspaceId);
}

/**
 * The id a stream starts from: everything already in the channel is in the
 * past, so a fresh stream only wants what comes next.
 */
export async function latestEventId(db: Db, workspaceId: string, projectId: string): Promise<string> {
  const rows = await db.query<{ id: string | null }>(
    "SELECT MAX(id) AS id FROM realtime_events WHERE workspace_id = $1 AND project_slug = $2",
    [workspaceId, projectId]
  );
  return rows[0]?.id ?? "0";
}

/** Events added since `afterId`, oldest first, with the id to continue from. */
export async function eventsSince(
  db: Db,
  workspaceId: string,
  projectId: string,
  afterId: string,
  limit = 100
): Promise<{ events: RealtimeEventPayload[]; cursor: string }> {
  const rows = await db.query<EventRow>(
    `SELECT id, type, project_slug, phase_key, origin, data, created_at
     FROM realtime_events
     WHERE workspace_id = $1 AND project_slug = $2 AND id > $3
     ORDER BY id
     LIMIT $4`,
    [workspaceId, projectId, afterId, limit]
  );
  return {
    events: rows.map((r) => toEvent(r, workspaceId)),
    cursor: rows.length ? rows[rows.length - 1].id : afterId,
  };
}

/** Clears events past their life. Called now and then by publishers, so nothing has to be scheduled. */
export async function pruneEvents(db: Db): Promise<void> {
  await db.query(`DELETE FROM realtime_events WHERE created_at < NOW() - INTERVAL '${EVENT_TTL_MINUTES} minutes'`);
}

/** Roughly one publish in twenty also tidies up, which is often enough to keep the table small. */
export function shouldPrune(random = Math.random()): boolean {
  return random < 0.05;
}
