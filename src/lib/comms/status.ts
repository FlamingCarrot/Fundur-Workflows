import type { Db } from "@/lib/db";
import type { MyStatus, PersonStatus } from "./types";

/**
 * Status: someone looking at Fundur in the last five minutes is available,
 * someone in a call is in a meeting, and anyone can set themselves busy or
 * away (with a note, until a time). Being away wins over a call; a call
 * wins over busy.
 */

const AROUND_MINUTES = 5;

/** Notes that this person is looking at Fundur now. */
export async function touchSeen(db: Db, workspaceId: string, personKey: string): Promise<void> {
  await db.query(
    `INSERT INTO people_status(workspace_id,person_key,seen_at) VALUES($1,$2,NOW())
     ON CONFLICT(workspace_id,person_key) DO UPDATE SET seen_at=NOW()`,
    [workspaceId, personKey],
  );
}

/** Sets or clears the status this person chose. */
export async function setMyStatus(db: Db, workspaceId: string, personKey: string, input: MyStatus): Promise<void> {
  await db.query(
    `INSERT INTO people_status(workspace_id,person_key,manual,note,manual_until) VALUES($1,$2,$3,$4,$5)
     ON CONFLICT(workspace_id,person_key) DO UPDATE SET manual=EXCLUDED.manual,note=EXCLUDED.note,manual_until=EXCLUDED.manual_until`,
    [workspaceId, personKey, input.manual, input.manual ? input.note : input.note, input.manual ? (input.until ?? null) : null],
  );
}

/** The status this person chose, as they set it. */
export async function myStatus(db: Db, workspaceId: string, personKey: string): Promise<MyStatus & { until: string | null }> {
  const [r] = await db.query<{ manual: "busy" | "away" | null; note: string; manual_until: Date | null }>(
    "SELECT manual,note,manual_until FROM people_status WHERE workspace_id=$1 AND person_key=$2",
    [workspaceId, personKey],
  );
  const live = r?.manual && (!r.manual_until || r.manual_until.getTime() > Date.now());
  return { manual: live ? r!.manual : null, note: r?.note ?? "", until: live && r!.manual_until ? r!.manual_until.toISOString() : null };
}

/** The status of each person named. */
export async function peopleStatus(db: Db, workspaceId: string, keys: string[]): Promise<Record<string, PersonStatus>> {
  if (!keys.length) return {};
  const rows = await db.query<{ person_key: string; around: boolean; manual: "busy" | "away" | null; note: string | null; in_call: boolean }>(
    `SELECT k AS person_key,
            COALESCE(ps.seen_at > NOW() - make_interval(mins => ${AROUND_MINUTES}), FALSE) AS around,
            CASE WHEN ps.manual IS NOT NULL AND (ps.manual_until IS NULL OR ps.manual_until > NOW()) THEN ps.manual END AS manual,
            ps.note,
            EXISTS (SELECT 1 FROM meeting_peers p JOIN meetings m ON m.id=p.meeting_id
                     WHERE m.workspace_id=$1 AND p.person_key=k AND p.left_at IS NULL AND p.last_seen_at > NOW() - INTERVAL '30 seconds') AS in_call
       FROM unnest($2::text[]) k LEFT JOIN people_status ps ON ps.workspace_id=$1 AND ps.person_key=k`,
    [workspaceId, keys],
  );
  const out: Record<string, PersonStatus> = {};
  for (const r of rows) {
    const state = r.manual === "away" ? "away" : r.in_call ? "meeting" : r.manual === "busy" ? "busy" : r.around ? "available" : "away";
    out[r.person_key] = { state, note: r.note ?? "" };
  }
  return out;
}
