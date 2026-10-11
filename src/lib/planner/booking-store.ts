import { randomBytes } from "node:crypto";
import type { Db } from "@/lib/db";
import { tokenHash, validToken } from "@/lib/workspaces/store";
import { availableSlots, type BookingLinkInput, type Busy } from "./booking";
import { getPlanner } from "./store";

/**
 * Calendar feeds and booking links: the two ways the calendar reaches outside
 * the app. Both are opened by a token in the address, with no sign-in.
 */

export class BookingError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
  }
}

const newToken = () => randomBytes(32).toString("base64url");

// ---------- Calendar feed ----------

/** Whether the person has a feed address; the address itself is only shown when it is made. */
export async function hasFeed(db: Db, workspaceId: string, userId: string): Promise<boolean> {
  const rows = await db.query("SELECT 1 FROM calendar_feeds WHERE workspace_id = $1 AND user_id = $2", [workspaceId, userId]);
  return rows.length > 0;
}

/** Makes a new feed token, replacing any earlier one, which then stops working. */
export async function resetFeed(db: Db, workspaceId: string, userId: string): Promise<string> {
  const token = newToken();
  await db.query(
    `INSERT INTO calendar_feeds (workspace_id, user_id, token_hash) VALUES ($1, $2, $3)
     ON CONFLICT (workspace_id, user_id) DO UPDATE SET token_hash = EXCLUDED.token_hash, created_at = NOW()`,
    [workspaceId, userId, tokenHash(token)]
  );
  return token;
}

export async function removeFeed(db: Db, workspaceId: string, userId: string): Promise<void> {
  await db.query("DELETE FROM calendar_feeds WHERE workspace_id = $1 AND user_id = $2", [workspaceId, userId]);
}

/** Whose feed a token opens, or null. */
export async function feedOwner(db: Db, token: string): Promise<{ workspaceId: string; userId: string } | null> {
  if (!validToken(token)) return null;
  const [row] = await db.query<{ workspace_id: string; user_id: string }>(
    "SELECT workspace_id, user_id FROM calendar_feeds WHERE token_hash = $1",
    [tokenHash(token)]
  );
  return row ? { workspaceId: row.workspace_id, userId: row.user_id } : null;
}

// ---------- Booking links ----------

export interface BookingLink {
  id: string;
  token: string;
  title: string;
  durationMinutes: number;
  fromDate: string;
  toDate: string;
  note?: string;
  projectId?: string;
  active: boolean;
  createdAt: string;
}

export interface Booking {
  id: string;
  linkId: string | null;
  title: string;
  start: string;
  end: string;
  name: string;
  email: string;
  note?: string;
  projectId?: string;
}

interface LinkRow {
  id: string;
  token: string;
  title: string;
  duration_minutes: number;
  from_date: Date | string;
  to_date: Date | string;
  note: string | null;
  project_slug: string | null;
  active: boolean;
  created_at: Date | string;
  workspace_id: string;
  user_id: string;
}

interface BookingRow {
  id: string;
  link_id: string | null;
  title: string;
  starts_at: Date | string;
  ends_at: Date | string;
  name: string;
  email: string;
  note: string | null;
  project_slug: string | null;
}

const day = (v: Date | string) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const iso = (v: Date | string) => new Date(v).toISOString();

const toLink = (r: LinkRow): BookingLink => ({
  id: r.id,
  token: r.token,
  title: r.title,
  durationMinutes: r.duration_minutes,
  fromDate: day(r.from_date),
  toDate: day(r.to_date),
  ...(r.note ? { note: r.note } : {}),
  ...(r.project_slug ? { projectId: r.project_slug } : {}),
  active: r.active,
  createdAt: iso(r.created_at),
});

const toBooking = (r: BookingRow): Booking => ({
  id: r.id,
  linkId: r.link_id,
  title: r.title,
  start: iso(r.starts_at),
  end: iso(r.ends_at),
  name: r.name,
  email: r.email,
  ...(r.note ? { note: r.note } : {}),
  ...(r.project_slug ? { projectId: r.project_slug } : {}),
});

export async function listLinks(db: Db, workspaceId: string, userId: string): Promise<BookingLink[]> {
  const rows = await db.query<LinkRow>(
    "SELECT * FROM booking_links WHERE workspace_id = $1 AND user_id = $2 ORDER BY created_at DESC",
    [workspaceId, userId]
  );
  return rows.map(toLink);
}

export async function createLink(db: Db, workspaceId: string, userId: string, input: BookingLinkInput): Promise<BookingLink> {
  const [row] = await db.query<LinkRow>(
    `INSERT INTO booking_links (workspace_id, user_id, token, title, duration_minutes, from_date, to_date, note, project_slug)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [workspaceId, userId, newToken(), input.title, input.durationMinutes, input.fromDate, input.toDate, input.note || null, input.projectId || null]
  );
  return toLink(row);
}

export async function setLinkActive(db: Db, workspaceId: string, userId: string, id: string, active: boolean): Promise<BookingLink> {
  const [row] = await db.query<LinkRow>(
    "UPDATE booking_links SET active = $4 WHERE workspace_id = $1 AND user_id = $2 AND id = $3 RETURNING *",
    [workspaceId, userId, id, active]
  );
  if (!row) throw new BookingError("That link no longer exists", 404);
  return toLink(row);
}

/** Deletes a link; meetings already booked through it stay. */
export async function deleteLink(db: Db, workspaceId: string, userId: string, id: string): Promise<void> {
  await db.query("DELETE FROM booking_links WHERE workspace_id = $1 AND user_id = $2 AND id = $3", [workspaceId, userId, id]);
}

/** The owner's meetings that overlap a range, cancelled ones left out. */
export async function listBookings(db: Db, workspaceId: string, userId: string, from: Date, to: Date): Promise<Booking[]> {
  const rows = await db.query<BookingRow>(
    `SELECT * FROM bookings WHERE workspace_id = $1 AND user_id = $2 AND cancelled_at IS NULL
       AND starts_at < $4 AND ends_at > $3 ORDER BY starts_at`,
    [workspaceId, userId, from.toISOString(), to.toISOString()]
  );
  return rows.map(toBooking);
}

export async function cancelBooking(db: Db, workspaceId: string, userId: string, id: string): Promise<void> {
  await db.query(
    "UPDATE bookings SET cancelled_at = NOW() WHERE workspace_id = $1 AND user_id = $2 AND id = $3 AND cancelled_at IS NULL",
    [workspaceId, userId, id]
  );
}

// ---------- The client's side of a booking link ----------

async function openLink(db: Db, token: string): Promise<LinkRow> {
  if (!validToken(token)) throw new BookingError("This booking link is not available", 404);
  const [row] = await db.query<LinkRow>("SELECT * FROM booking_links WHERE token = $1 AND active", [token]);
  if (!row) throw new BookingError("This booking link is not available", 404);
  return row;
}

/** What the owner already has booked across the link's dates, a day either side for time zones. */
async function ownerBusy(db: Db, row: LinkRow): Promise<Busy[]> {
  const from = new Date(Date.parse(`${day(row.from_date)}T00:00:00Z`) - 86_400_000);
  const to = new Date(Date.parse(`${day(row.to_date)}T00:00:00Z`) + 2 * 86_400_000);
  const booked = await listBookings(db, row.workspace_id, row.user_id, from, to);
  return booked.map((b) => ({ start: new Date(b.start), end: new Date(b.end) }));
}

export interface PublicLink {
  title: string;
  owner: string;
  durationMinutes: number;
  note?: string;
  timeZone: string;
  slots: string[];
}

/** What a client sees: the meeting, whose time it is, and the start times on offer. */
export async function publicLink(db: Db, token: string, now = new Date()): Promise<PublicLink> {
  const row = await openLink(db, token);
  const { state } = await getPlanner(db, row.workspace_id, row.user_id);
  const [owner] = await db.query<{ name: string | null }>("SELECT name FROM users WHERE id = $1", [row.user_id]);
  const slots = availableSlots({
    workWeek: state.workWeek,
    fromDate: day(row.from_date),
    toDate: day(row.to_date),
    durationMinutes: row.duration_minutes,
    busy: await ownerBusy(db, row),
    now,
  });
  return {
    title: row.title,
    owner: owner?.name || "Your designer",
    durationMinutes: row.duration_minutes,
    ...(row.note ? { note: row.note } : {}),
    timeZone: state.workWeek.timeZone,
    slots: slots.map((s) => s.toISOString()),
  };
}

/** Books a time, if it is still on offer. */
export async function book(
  db: Db,
  token: string,
  request: { start: string; name: string; email: string; note?: string },
  now = new Date()
): Promise<Booking> {
  const row = await openLink(db, token);
  const { state } = await getPlanner(db, row.workspace_id, row.user_id);
  const start = new Date(request.start);
  const offered = availableSlots({
    workWeek: state.workWeek,
    fromDate: day(row.from_date),
    toDate: day(row.to_date),
    durationMinutes: row.duration_minutes,
    busy: await ownerBusy(db, row),
    now,
  });
  if (!offered.some((s) => s.getTime() === start.getTime())) {
    throw new BookingError("That time has just been taken or is no longer open. Pick another.", 409);
  }
  const end = new Date(start.getTime() + row.duration_minutes * 60_000);
  // Only books when nothing overlaps; the unique index catches two clients picking the same start at once.
  const inserted = await db
    .query<BookingRow>(
      `INSERT INTO bookings (link_id, workspace_id, user_id, title, starts_at, ends_at, name, email, note, project_slug)
       SELECT $1::uuid, $2::uuid, $3::varchar, $4::text, $5::timestamptz, $6::timestamptz, $7::text, $8::text, $9::text, $10::text
       WHERE NOT EXISTS (
         SELECT 1 FROM bookings WHERE user_id = $3::varchar AND cancelled_at IS NULL AND starts_at < $6::timestamptz AND ends_at > $5::timestamptz
       )
       RETURNING *`,
      [row.id, row.workspace_id, row.user_id, `${row.title} with ${request.name}`, start.toISOString(), end.toISOString(),
        request.name, request.email, request.note || null, row.project_slug]
    )
    .catch((err: { code?: string }) => {
      if (err.code === "23505") return [];
      throw err;
    });
  if (!inserted.length) throw new BookingError("That time has just been taken. Pick another.", 409);
  return toBooking(inserted[0]);
}
