import type { Db } from "@/lib/db";
import type { PlatformRole } from "./permissions";

/**
 * The platform Admin is named in the build plan. A sign-in becomes Admin when
 * its email is on this list and Auth0 says the email is verified; the role is
 * then stored against that Auth0 user id. An unverified email never grants it,
 * so nobody can claim the role by signing up with the address. Set
 * PLATFORM_ADMIN_EMAILS (comma separated) to change the list.
 */
const DEFAULT_ADMIN_EMAILS = ["andre1.swanepoel1@gmail.com"];

export function adminEmails(): string[] {
  const raw = process.env.PLATFORM_ADMIN_EMAILS;
  const list = raw ? raw.split(",") : DEFAULT_ADMIN_EMAILS;
  return list.map((e) => e.trim().toLowerCase()).filter(Boolean);
}

export interface SessionUser {
  sub: string;
  email?: string | null;
  email_verified?: boolean | null;
  name?: string | null;
  picture?: string | null;
}

/** 'active' can use the app; 'disabled' was switched off; 'waiting' signed up while sign-ups were invite only. */
export type UserStatus = "active" | "disabled" | "waiting";

/** How the Admin sees the app: everything, or only what a basic user sees. */
export type ViewMode = "admin" | "basic";

export interface AppUser {
  id: string;
  name: string | null;
  email: string | null;
  platformRole: PlatformRole;
  status: UserStatus;
  viewMode: ViewMode;
}

/** True when this sign-in should hold the Admin role. */
export function qualifiesAsAdmin(user: SessionUser): boolean {
  const email = user.email?.trim().toLowerCase();
  return Boolean(email && user.email_verified === true && adminEmails().includes(email));
}

/** The address an invite can be matched to: only one Auth0 says is verified. */
function verifiedEmail(user: SessionUser): string | null {
  const email = user.email?.trim().toLowerCase();
  return email && user.email_verified === true ? email : null;
}

interface UserRow {
  platform_role: string;
  status: string;
  view_mode: string;
  inserted: boolean;
}

const asStatus = (s: string): UserStatus => (s === "disabled" || s === "waiting" ? s : "active");

/**
 * Records the signed-in person and returns their platform role and status.
 * Admin is granted here and kept by user id; it is never taken away by a later
 * sign-in, only by changing the row.
 *
 * Someone new is let in straight away unless sign-ups are invite only; then
 * they wait for the Admin, unless an invite to their verified address exists,
 * which this uses up.
 */
export async function syncUser(db: Db, user: SessionUser): Promise<AppUser> {
  const admin = qualifiesAsAdmin(user);
  const email = verifiedEmail(user);
  let [row] = await db.query<UserRow>(
    `INSERT INTO users (id, email, name, avatar_url, platform_role, status, last_seen_at)
     VALUES ($1, $2, $3, $4, CASE WHEN $5::boolean THEN 'admin' ELSE 'user' END,
       CASE WHEN $5::boolean THEN 'active'
            WHEN COALESCE((SELECT invite_only FROM platform_access LIMIT 1), FALSE)
                 AND NOT EXISTS (
                   SELECT 1 FROM invites
                   WHERE LOWER(email) = $6 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()
                 )
            THEN 'waiting' ELSE 'active' END,
       NOW())
     ON CONFLICT (id) DO UPDATE SET
       email = EXCLUDED.email, name = EXCLUDED.name, avatar_url = EXCLUDED.avatar_url,
       platform_role = CASE WHEN $5::boolean THEN 'admin' ELSE users.platform_role END,
       status = CASE WHEN $5::boolean THEN 'active' ELSE users.status END,
       last_seen_at = NOW(), updated_at = NOW()
     RETURNING platform_role, status, view_mode, (xmax = 0) AS inserted`,
    [user.sub, user.email ?? null, user.name ?? null, user.picture ?? null, admin, email]
  );
  // A new or waiting person whose verified address was invited takes the invite up.
  if (email && (row.inserted || row.status === "waiting")) {
    const [invite] = await db.query<{ id: string }>(
      `SELECT id FROM invites
       WHERE LOWER(email) = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [email]
    );
    if (invite) row = (await takeUpInvite(db, invite.id, user.sub)) ?? row;
  }
  return {
    id: user.sub,
    name: user.name ?? null,
    email: user.email ?? null,
    platformRole: row.platform_role === "admin" ? "admin" : "user",
    status: asStatus(row.status),
    viewMode: row.view_mode === "basic" ? "basic" : "admin",
  };
}

/**
 * Marks an invite used by this person and gives them what it grants: the
 * invite's role, and entry if they were waiting. A disabled person stays
 * disabled. Null when the invite was already used, revoked or expired.
 */
async function takeUpInvite(db: Db, inviteId: string, userId: string): Promise<UserRow | null> {
  const [taken] = await db.query<{ platform_role: string }>(
    `UPDATE invites SET accepted_by = $2, accepted_at = NOW()
     WHERE id = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()
     RETURNING platform_role`,
    [inviteId, userId]
  );
  if (!taken) return null;
  const [row] = await db.query<UserRow>(
    `UPDATE users SET
       platform_role = CASE WHEN $2 = 'admin' THEN 'admin' ELSE platform_role END,
       status = CASE WHEN status = 'waiting' THEN 'active' ELSE status END,
       updated_at = NOW()
     WHERE id = $1
     RETURNING platform_role, status, view_mode, FALSE AS inserted`,
    [userId, taken.platform_role]
  );
  return row ?? null;
}

export type InviteLinkResult = "accepted" | "invalid" | "wrong_email";

/**
 * The invite link, opened by a signed-in person. Anyone holding the link may
 * use an invite to a basic account, so it works when she signs up with another
 * address; an invite that makes someone Admin needs the invited address,
 * verified, so a forwarded link cannot hand out the role.
 */
export async function acceptInviteLink(db: Db, user: SessionUser, token: string): Promise<InviteLinkResult> {
  const [invite] = await db.query<{ id: string; email: string; platform_role: string; accepted_by: string | null; open: boolean }>(
    `SELECT id, email, platform_role, accepted_by,
            (accepted_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()) AS open
     FROM invites WHERE token = $1`,
    [token]
  );
  if (!invite) return "invalid";
  // Signing in with the invited address already used it up.
  if (invite.accepted_by === user.sub) return "accepted";
  if (!invite.open) return "invalid";
  if (invite.platform_role === "admin" && verifiedEmail(user) !== invite.email.trim().toLowerCase()) {
    return "wrong_email";
  }
  await syncUser(db, user);
  if (await takeUpInvite(db, invite.id, user.sub)) return "accepted";
  const [mine] = await db.query("SELECT 1 FROM invites WHERE id = $1 AND accepted_by = $2", [invite.id, user.sub]);
  return mine ? "accepted" : "invalid";
}

/** The Admin's own choice of view, kept with them so every device shows the same. */
export async function setViewMode(db: Db, userId: string, mode: ViewMode): Promise<void> {
  await db.query("UPDATE users SET view_mode = $2 WHERE id = $1", [userId, mode]);
}
