import type { Db } from "@/lib/db";
import { openAsksFor, type AskView } from "./store";

/**
 * The inbox: everything the AI needs from her, across her projects. Questions
 * the autopilot asked, changes waiting for her review (from the autopilot or
 * the chat), and what the autopilot did lately, each with Undo.
 */

export interface InboxProject {
  id: string;
  slug: string;
  name: string;
  client: string;
  swatch: string;
  autopilot: { enabled: boolean; paused: boolean; nextRunAt: string | null; nextReason: string | null; running: boolean };
}

export interface InboxChange {
  id: string;
  projectId: string;
  summary: string;
  kind: string;
  status: "pending" | "applied";
  undoable: boolean;
  /** Made by the autopilot rather than in the chat. */
  autopilot: boolean;
  createdAt: string;
}

export interface Inbox {
  projects: InboxProject[];
  asks: AskView[];
  review: InboxChange[];
  done: InboxChange[];
}

const iso = (v: unknown) => new Date(v as string).toISOString();

export async function readInbox(db: Db, workspaceId: string, slugs: string[] | null): Promise<Inbox> {
  const rows = await db.query<Record<string, unknown>>(
    `SELECT p.id, p.slug, p.name, p.client_name, p.swatch, a.enabled, a.paused, a.next_run_at, a.next_reason, a.running_since
     FROM projects p LEFT JOIN project_autopilot a ON a.project_id = p.id
     WHERE p.workspace_id = $1 AND p.status = 'active' ${slugs ? "AND p.slug = ANY($2::text[])" : ""}`,
    slugs ? [workspaceId, slugs] : [workspaceId]
  );
  const projects: InboxProject[] = rows.map((r) => {
    return {
      id: String(r.id),
      slug: String(r.slug),
      name: String(r.name),
      client: String(r.client_name ?? ""),
      swatch: String(r.swatch ?? "clay"),
      autopilot: {
        enabled: !!r.enabled,
        paused: !!r.paused,
        nextRunAt: r.next_run_at ? iso(r.next_run_at) : null,
        nextReason: (r.next_reason as string) ?? null,
        running: !!r.running_since && Date.now() - new Date(r.running_since as string).getTime() < 15 * 60_000,
      },
    };
  });
  const ids = projects.map((p) => p.id);
  if (!ids.length) return { projects, asks: [], review: [], done: [] };
  const changes = await db.query<Record<string, unknown>>(
    `SELECT pr.id, pr.project_id, pr.summary, pr.mutation->>'type' AS kind, pr.status, pr.undo IS NOT NULL AS undoable, pr.created_at,
            COALESCE(m.events @> '[{"type":"autopilot"}]'::jsonb, FALSE) AS autopilot
     FROM ai_proposals pr LEFT JOIN ai_chat_messages m ON m.id = pr.message_id
     WHERE pr.project_id = ANY($1::uuid[]) AND (
       pr.status = 'pending' OR
       (pr.status = 'applied' AND pr.direct AND pr.created_at > NOW() - INTERVAL '3 days' AND m.events @> '[{"type":"autopilot"}]'::jsonb)
     )
     ORDER BY pr.created_at DESC LIMIT 200`,
    [ids]
  );
  const toChange = (r: Record<string, unknown>): InboxChange => ({
    id: String(r.id),
    projectId: String(r.project_id),
    summary: String(r.summary),
    kind: String(r.kind),
    status: r.status as InboxChange["status"],
    undoable: !!r.undoable,
    autopilot: !!r.autopilot,
    createdAt: iso(r.created_at),
  });
  return {
    projects,
    asks: await openAsksFor(db, ids),
    review: changes.filter((r) => r.status === "pending").map(toChange),
    done: changes.filter((r) => r.status === "applied").map(toChange),
  };
}

/** How many things wait for her: open questions and changes to review. */
export async function inboxCount(db: Db, workspaceId: string, slugs: string[] | null): Promise<number> {
  const [row] = await db.query<{ n: string | number }>(
    `SELECT (SELECT COUNT(*) FROM autopilot_asks k JOIN projects p ON p.id = k.project_id
              WHERE k.workspace_id = $1 AND k.status = 'open' AND p.status = 'active' ${slugs ? "AND p.slug = ANY($2::text[])" : ""})
          + (SELECT COUNT(*) FROM ai_proposals pr JOIN projects p ON p.id = pr.project_id
              WHERE pr.workspace_id = $1 AND pr.status = 'pending' AND p.status = 'active' ${slugs ? "AND p.slug = ANY($2::text[])" : ""}) AS n`,
    slugs ? [workspaceId, slugs] : [workspaceId]
  );
  return Number(row?.n ?? 0);
}
