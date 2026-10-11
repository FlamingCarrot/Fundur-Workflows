import type { Db } from "@/lib/db";
import { deviceOf, routeOf, type Device, type UsageBatch } from "./events";

/**
 * Usage events in the database: storing what the tracker sends, and the
 * readings the Admin's usage pages and the advisor are built from.
 */

export interface Tracked {
  userId: string | null;
  workspaceId: string | null;
  isAdmin: boolean;
}

/** Who a signed-in Auth0 user is, without writing anything (the tracker calls often). */
export async function trackedUser(db: Db, sub: string): Promise<Tracked> {
  const [row] = await db.query<{ id: string; platform_role: string; workspace_id: string | null }>(
    `SELECT u.id, u.platform_role,
       (SELECT m.workspace_id FROM memberships m WHERE m.user_id = u.id ORDER BY m.created_at LIMIT 1) AS workspace_id
     FROM users u WHERE u.id = $1`,
    [sub]
  );
  if (!row) return { userId: null, workspaceId: null, isAdmin: false };
  return { userId: row.id, workspaceId: row.workspace_id, isAdmin: row.platform_role === "admin" };
}

/** Events older than this are deleted; long enough to compare a year with the one before. */
export const KEEP_DAYS = 395;

export async function recordEvents(db: Db, who: Tracked, batch: UsageBatch): Promise<number> {
  const rows = batch.events.map((e) => ({
    type: e.type,
    path: e.path || "/",
    route: routeOf(e.path || "/"),
    target: e.target ?? null,
    x: e.x ?? null,
    y: e.y ?? null,
    vw: e.vw ?? null,
    vh: e.vh ?? null,
    device: deviceOf(e.vw),
    duration_ms: e.durationMs ?? null,
    age_ms: e.ageMs ?? 0,
    data: e.data ?? {},
  }));
  await db.query(
    `INSERT INTO usage_events (workspace_id, user_id, is_admin, session_id, type, path, route, target,
       x, y, viewport_w, viewport_h, device, duration_ms, data, created_at)
     SELECT $1, $2, $3, $4, e.type, e.path, e.route, e.target, e.x, e.y, e.vw, e.vh, e.device, e.duration_ms,
       COALESCE(e.data, '{}'::jsonb), NOW() - make_interval(secs => e.age_ms / 1000.0)
     FROM jsonb_to_recordset($5::jsonb) AS e(type text, path text, route text, target text, x real, y real,
       vw int, vh int, device text, duration_ms int, age_ms int, data jsonb)`,
    [who.workspaceId, who.userId, who.isAdmin, batch.sessionId, JSON.stringify(rows)]
  );
  return rows.length;
}

export async function pruneUsage(db: Db, keepDays = KEEP_DAYS): Promise<void> {
  await db.query("DELETE FROM usage_events WHERE created_at < NOW() - make_interval(days => $1)", [keepDays]);
}

// ---------------------------------------------------------------------------
// Live view
// ---------------------------------------------------------------------------

/** A tab counts as online while it has sent anything (a heartbeat comes every 30 s) this recently. */
export const ONLINE_SECONDS = 75;

export interface LiveSession {
  sessionId: string;
  user: { name: string | null; email: string | null } | null;
  workspace: string | null;
  path: string;
  route: string;
  device: Device | null;
  startedAt: string;
  lastSeenAt: string;
  events: number;
}

export interface LiveEvent {
  id: number;
  type: string;
  path: string;
  route: string;
  target: string | null;
  device: Device | null;
  durationMs: number | null;
  sessionId: string;
  user: { name: string | null; email: string | null } | null;
  at: string;
}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());

export async function liveView(
  db: Db,
  opts: { afterId?: number; includeAdmin?: boolean; limit?: number } = {}
): Promise<{ online: LiveSession[]; events: LiveEvent[]; lastId: number }> {
  const includeAdmin = Boolean(opts.includeAdmin);
  const online = await db.query<Record<string, unknown>>(
    `WITH recent AS (
       SELECT DISTINCT session_id FROM usage_events
       WHERE created_at > NOW() - make_interval(secs => $1) AND ($2::boolean OR NOT is_admin)
     ), last AS (
       SELECT DISTINCT ON (e.session_id) e.session_id, e.path, e.route, e.device, e.user_id, e.workspace_id, e.created_at
       FROM usage_events e JOIN recent r USING (session_id)
       ORDER BY e.session_id, e.id DESC
     )
     SELECT l.session_id, l.path, l.route, l.device, u.name, u.email, w.name AS workspace,
       s.started_at, s.last_seen_at, s.events
     FROM last l
     JOIN LATERAL (
       SELECT MIN(created_at) AS started_at, MAX(created_at) AS last_seen_at, COUNT(*)::int AS events
       FROM usage_events WHERE session_id = l.session_id
     ) s ON TRUE
     LEFT JOIN users u ON u.id = l.user_id
     LEFT JOIN workspaces w ON w.id = l.workspace_id
     ORDER BY s.last_seen_at DESC`,
    [ONLINE_SECONDS, includeAdmin]
  );

  const limit = Math.min(Math.max(opts.limit ?? 80, 1), 300);
  const events = await db.query<Record<string, unknown>>(
    `SELECT e.id, e.type, e.path, e.route, e.target, e.device, e.duration_ms, e.session_id, e.created_at, u.name, u.email
     FROM usage_events e LEFT JOIN users u ON u.id = e.user_id
     WHERE e.id > $1 AND e.type <> 'heartbeat' AND ($2::boolean OR NOT e.is_admin)
     ORDER BY e.id DESC LIMIT $3`,
    [opts.afterId ?? 0, includeAdmin, limit]
  );
  const [{ max }] = await db.query<{ max: string | null }>("SELECT MAX(id)::text AS max FROM usage_events");

  const person = (r: Record<string, unknown>) =>
    r.name || r.email ? { name: (r.name as string) ?? null, email: (r.email as string) ?? null } : null;
  return {
    online: online.map((r) => ({
      sessionId: String(r.session_id),
      user: person(r),
      workspace: (r.workspace as string) ?? null,
      path: String(r.path),
      route: String(r.route),
      device: (r.device as Device) ?? null,
      startedAt: iso(r.started_at),
      lastSeenAt: iso(r.last_seen_at),
      events: Number(r.events),
    })),
    events: events.map((r) => ({
      id: Number(r.id),
      type: String(r.type),
      path: String(r.path),
      route: String(r.route),
      target: (r.target as string) ?? null,
      device: (r.device as Device) ?? null,
      durationMs: r.duration_ms == null ? null : Number(r.duration_ms),
      sessionId: String(r.session_id),
      user: person(r),
      at: iso(r.created_at),
    })),
    lastId: Number(max ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export interface Totals {
  activeUsers: number;
  sessions: number;
  pageViews: number;
  clicks: number;
  actions: number;
  errors: number;
  avgSessionMinutes: number;
}

export interface PageStats {
  route: string;
  views: number;
  users: number;
  avgSeconds: number | null;
  avgScroll: number | null;
  exits: number;
  errors: number;
  rageClicks: number;
  deadClicks: number;
}

export interface Overview {
  days: number;
  totals: Totals;
  previous: Totals;
  daily: { day: string; users: number; sessions: number; pageViews: number }[];
  pages: PageStats[];
  actions: { name: string; count: number; users: number }[];
  errors: { message: string; route: string; count: number; users: number; lastAt: string }[];
  rageClicks: { route: string; target: string; bursts: number; users: number }[];
  deadClicks: { route: string; target: string; count: number; users: number }[];
  funnel: { step: string; users: number }[];
  devices: { device: string; sessions: number }[];
  signups: number;
  returningUsers: number;
}

const num = (v: unknown) => (v == null ? 0 : Number(v));
const numOrNull = (v: unknown) => (v == null ? null : Math.round(Number(v) * 100) / 100);

/** $1 = from (days ago), $2 = to (days ago), $3 = include the Admin's own events. */
const WINDOW = `created_at >= NOW() - make_interval(days => $1) AND created_at < NOW() - make_interval(days => $2)
  AND ($3::boolean OR NOT is_admin)`;

async function totals(db: Db, from: number, to: number, includeAdmin: boolean): Promise<Totals> {
  const [r] = await db.query<Record<string, unknown>>(
    `SELECT COUNT(DISTINCT user_id) AS users, COUNT(DISTINCT session_id) AS sessions,
       COUNT(*) FILTER (WHERE type = 'page_view') AS views,
       COUNT(*) FILTER (WHERE type = 'click') AS clicks,
       COUNT(*) FILTER (WHERE type = 'action') AS actions,
       COUNT(*) FILTER (WHERE type = 'error') AS errors
     FROM usage_events WHERE ${WINDOW}`,
    [from, to, includeAdmin]
  );
  const [s] = await db.query<{ avg: unknown }>(
    `SELECT AVG(EXTRACT(EPOCH FROM (last - first)) / 60) AS avg FROM (
       SELECT MIN(created_at) AS first, MAX(created_at) AS last FROM usage_events WHERE ${WINDOW} GROUP BY session_id
     ) s`,
    [from, to, includeAdmin]
  );
  return {
    activeUsers: num(r.users),
    sessions: num(r.sessions),
    pageViews: num(r.views),
    clicks: num(r.clicks),
    actions: num(r.actions),
    errors: num(r.errors),
    avgSessionMinutes: Math.round(num(s?.avg) * 10) / 10,
  };
}

/** Three or more clicks on the same thing within a second: someone expected it to work. */
const RAGE_SQL = `
  WITH c AS (
    SELECT session_id, user_id, route, target, created_at,
      COUNT(*) OVER (PARTITION BY session_id, route, target ORDER BY created_at
        RANGE BETWEEN INTERVAL '1 second' PRECEDING AND CURRENT ROW) AS n
    FROM usage_events WHERE type = 'click' AND target IS NOT NULL AND ${WINDOW}
  )
  SELECT route, target, COUNT(*) AS bursts, COUNT(DISTINCT user_id) AS users FROM c WHERE n = 3
  GROUP BY route, target ORDER BY bursts DESC LIMIT 20`;

export async function usageOverview(db: Db, opts: { days?: number; includeAdmin?: boolean } = {}): Promise<Overview> {
  const days = Math.min(Math.max(Math.round(opts.days ?? 30), 1), 365);
  const inc = Boolean(opts.includeAdmin);
  const p = [days, 0, inc];

  const [current, previous, daily, pages, exits, rage, dead, actions, errors, funnel, devices, people] = await Promise.all([
    totals(db, days, 0, inc),
    totals(db, days * 2, days, inc),
    db.query<Record<string, unknown>>(
      `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day, COUNT(DISTINCT user_id) AS users,
         COUNT(DISTINCT session_id) AS sessions, COUNT(*) FILTER (WHERE type = 'page_view') AS views
       FROM usage_events WHERE ${WINDOW} GROUP BY 1 ORDER BY 1`,
      p
    ),
    db.query<Record<string, unknown>>(
      `SELECT route,
         COUNT(*) FILTER (WHERE type = 'page_view') AS views,
         COUNT(DISTINCT user_id) FILTER (WHERE type = 'page_view') AS users,
         AVG(duration_ms) FILTER (WHERE type = 'page_leave') / 1000.0 AS avg_seconds,
         AVG((data->>'scroll')::numeric) FILTER (WHERE type = 'page_leave' AND data ? 'scroll') AS avg_scroll,
         COUNT(*) FILTER (WHERE type = 'error') AS errors,
         COUNT(*) FILTER (WHERE type = 'click' AND data->>'dead' = 'true') AS dead
       FROM usage_events WHERE ${WINDOW} GROUP BY route
       HAVING COUNT(*) FILTER (WHERE type = 'page_view') > 0 ORDER BY views DESC LIMIT 40`,
      p
    ),
    // The page each visit ended on.
    db.query<Record<string, unknown>>(
      `SELECT route, COUNT(*) AS exits FROM (
         SELECT DISTINCT ON (session_id) session_id, route FROM usage_events
         WHERE type = 'page_view' AND ${WINDOW} ORDER BY session_id, id DESC
       ) s GROUP BY route`,
      p
    ),
    db.query<Record<string, unknown>>(RAGE_SQL, p),
    db.query<Record<string, unknown>>(
      `SELECT route, target, COUNT(*) AS count, COUNT(DISTINCT user_id) AS users FROM usage_events
       WHERE type = 'click' AND data->>'dead' = 'true' AND target IS NOT NULL AND ${WINDOW}
       GROUP BY route, target ORDER BY count DESC LIMIT 20`,
      p
    ),
    db.query<Record<string, unknown>>(
      `SELECT target AS name, COUNT(*) AS count, COUNT(DISTINCT user_id) AS users FROM usage_events
       WHERE type = 'action' AND target IS NOT NULL AND ${WINDOW} GROUP BY target ORDER BY count DESC LIMIT 40`,
      p
    ),
    db.query<Record<string, unknown>>(
      `SELECT target AS message, route, COUNT(*) AS count, COUNT(DISTINCT user_id) AS users, MAX(created_at) AS last_at
       FROM usage_events WHERE type = 'error' AND ${WINDOW} GROUP BY target, route ORDER BY count DESC LIMIT 20`,
      p
    ),
    db.query<Record<string, unknown>>(
      `SELECT
         COUNT(DISTINCT user_id) FILTER (WHERE type = 'page_view') AS visited,
         COUNT(DISTINCT user_id) FILTER (WHERE type = 'page_view' AND route LIKE '/projects/:project%') AS opened,
         COUNT(DISTINCT user_id) FILTER (WHERE type = 'action' AND target = 'createProject') AS created,
         COUNT(DISTINCT user_id) FILTER (WHERE type = 'action' AND target = 'setCheck') AS ticked,
         COUNT(DISTINCT user_id) FILTER (WHERE type = 'action' AND target = 'completePhase') AS completed
       FROM usage_events WHERE ${WINDOW}`,
      p
    ),
    db.query<Record<string, unknown>>(
      `SELECT COALESCE(device, 'unknown') AS device, COUNT(DISTINCT session_id) AS sessions FROM usage_events
       WHERE ${WINDOW} GROUP BY 1 ORDER BY 2 DESC`,
      p
    ),
    db.query<Record<string, unknown>>(
      `SELECT
         (SELECT COUNT(*) FROM users WHERE created_at >= NOW() - make_interval(days => $1)) AS signups,
         (SELECT COUNT(DISTINCT user_id) FROM usage_events WHERE ${WINDOW} AND user_id IN (
            SELECT user_id FROM usage_events WHERE created_at >= NOW() - make_interval(days => $1 * 2)
              AND created_at < NOW() - make_interval(days => $1) AND user_id IS NOT NULL)) AS returning`,
      p
    ),
  ]);

  const exitsBy = new Map(exits.map((r) => [String(r.route), num(r.exits)]));
  const rageBy = new Map<string, number>();
  for (const r of rage) rageBy.set(String(r.route), (rageBy.get(String(r.route)) ?? 0) + num(r.bursts));
  const f = funnel[0] ?? {};

  return {
    days,
    totals: current,
    previous,
    daily: daily.map((r) => ({ day: String(r.day), users: num(r.users), sessions: num(r.sessions), pageViews: num(r.views) })),
    pages: pages.map((r) => ({
      route: String(r.route),
      views: num(r.views),
      users: num(r.users),
      avgSeconds: numOrNull(r.avg_seconds),
      avgScroll: numOrNull(r.avg_scroll),
      exits: exitsBy.get(String(r.route)) ?? 0,
      errors: num(r.errors),
      rageClicks: rageBy.get(String(r.route)) ?? 0,
      deadClicks: num(r.dead),
    })),
    actions: actions.map((r) => ({ name: String(r.name), count: num(r.count), users: num(r.users) })),
    errors: errors.map((r) => ({
      message: String(r.message ?? "Unknown error"),
      route: String(r.route),
      count: num(r.count),
      users: num(r.users),
      lastAt: iso(r.last_at),
    })),
    rageClicks: rage.map((r) => ({ route: String(r.route), target: String(r.target), bursts: num(r.bursts), users: num(r.users) })),
    deadClicks: dead.map((r) => ({ route: String(r.route), target: String(r.target), count: num(r.count), users: num(r.users) })),
    funnel: [
      { step: "Used the app", users: num(f.visited) },
      { step: "Opened a project", users: num(f.opened) },
      { step: "Created a project", users: num(f.created) },
      { step: "Ticked off a step", users: num(f.ticked) },
      { step: "Completed a phase", users: num(f.completed) },
    ],
    devices: devices.map((r) => ({ device: String(r.device), sessions: num(r.sessions) })),
    signups: num(people[0]?.signups),
    returningUsers: num(people[0]?.returning),
  };
}

// ---------------------------------------------------------------------------
// Heat map
// ---------------------------------------------------------------------------

export interface HeatPoint {
  x: number;
  y: number;
  vw: number;
  /** The clicked element as a CSS path, and where in it, so the dot lands on it even if the page moved. */
  selector: string | null;
  ox: number | null;
  oy: number | null;
}

export interface Heatmap {
  routes: { route: string; clicks: number }[];
  route: string | null;
  /** A real page of this kind to draw the dots over. */
  samplePath: string | null;
  points: HeatPoint[];
  targets: { target: string; clicks: number; users: number; dead: number }[];
  /** How far down people scrolled: the share of visits that reached each tenth of the page. */
  scrollReach: number[];
}

export const MAX_HEAT_POINTS = 5_000;

export async function heatmap(
  db: Db,
  opts: { route?: string; device?: Device; days?: number; includeAdmin?: boolean } = {}
): Promise<Heatmap> {
  const days = Math.min(Math.max(Math.round(opts.days ?? 30), 1), 365);
  const inc = Boolean(opts.includeAdmin);
  const routes = await db.query<Record<string, unknown>>(
    `SELECT route, COUNT(*) AS clicks FROM usage_events WHERE type = 'click' AND ${WINDOW}
     GROUP BY route ORDER BY clicks DESC LIMIT 60`,
    [days, 0, inc]
  );
  const route = opts.route ?? (routes[0]?.route as string | undefined) ?? null;
  const list = routes.map((r) => ({ route: String(r.route), clicks: num(r.clicks) }));
  if (!route) return { routes: list, route: null, samplePath: null, points: [], targets: [], scrollReach: [] };

  const device = opts.device ?? "desktop";
  const params = [days, 0, inc, route, device];
  const [sample, points, targets, scrolls] = await Promise.all([
    db.query<{ path: string }>(
      `SELECT path FROM usage_events WHERE route = $4 AND type = 'page_view' AND ${WINDOW}
       GROUP BY path ORDER BY COUNT(*) DESC LIMIT 1`,
      params.slice(0, 4)
    ),
    db.query<Record<string, unknown>>(
      `SELECT x, y, viewport_w, data->>'sel' AS sel, data->>'ox' AS ox, data->>'oy' AS oy FROM usage_events
       WHERE type = 'click' AND route = $4 AND device = $5 AND x IS NOT NULL AND ${WINDOW}
       ORDER BY id DESC LIMIT ${MAX_HEAT_POINTS}`,
      params
    ),
    db.query<Record<string, unknown>>(
      `SELECT target, COUNT(*) AS clicks, COUNT(DISTINCT user_id) AS users,
         COUNT(*) FILTER (WHERE data->>'dead' = 'true') AS dead FROM usage_events
       WHERE type = 'click' AND route = $4 AND device = $5 AND target IS NOT NULL AND ${WINDOW}
       GROUP BY target ORDER BY clicks DESC LIMIT 25`,
      params
    ),
    db.query<{ scroll: unknown }>(
      `SELECT (data->>'scroll')::numeric AS scroll FROM usage_events
       WHERE type = 'page_leave' AND route = $4 AND device = $5 AND data ? 'scroll' AND ${WINDOW}
       ORDER BY id DESC LIMIT 2000`,
      params
    ),
  ]);

  const depths = scrolls.map((s) => Number(s.scroll));
  const scrollReach = depths.length
    ? Array.from({ length: 10 }, (_, i) => depths.filter((d) => d >= (i + 1) / 10 - 0.001).length / depths.length)
    : [];

  return {
    routes: list,
    route,
    samplePath: sample[0]?.path ?? null,
    points: points.map((r) => ({
      x: Number(r.x),
      y: Number(r.y),
      vw: num(r.viewport_w),
      selector: (r.sel as string) ?? null,
      ox: r.ox == null ? null : Number(r.ox),
      oy: r.oy == null ? null : Number(r.oy),
    })),
    targets: targets.map((r) => ({ target: String(r.target), clicks: num(r.clicks), users: num(r.users), dead: num(r.dead) })),
    scrollReach,
  };
}
