import { randomBytes } from "crypto";
import type { Db } from "@/lib/db";
import type { PlatformRole } from "@/lib/auth/permissions";
import type { UserStatus } from "@/lib/auth/users";

/**
 * User management for the platform Admin: everyone who has signed in, the
 * invites still waiting, and who may sign up at all. A plan or tier can sit
 * beside the role later; nothing here assumes there is none.
 */

/** How long an invite link works. */
export const INVITE_DAYS = 14;

export interface ManagedUser {
  id: string;
  name: string | null;
  email: string;
  role: PlatformRole;
  status: UserStatus;
  workspace: string | null;
  projects: number;
  openTickets: number;
  joinedAt: string;
  lastSeenAt: string | null;
}

export interface PendingInvite {
  id: string;
  email: string;
  name: string | null;
  role: PlatformRole;
  token: string;
  invitedBy: string | null;
  createdAt: string;
  expiresAt: string;
}

const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);
const asRole = (r: string): PlatformRole => (r === "admin" ? "admin" : "user");
const asStatus = (s: string): UserStatus => (s === "disabled" || s === "waiting" ? s : "active");

export async function listUsers(db: Db): Promise<ManagedUser[]> {
  const rows = await db.query<{
    id: string;
    name: string | null;
    email: string;
    platform_role: string;
    status: string;
    workspace: string | null;
    projects: string | number;
    open_tickets: string | number;
    created_at: Date | string;
    last_seen_at: Date | string | null;
  }>(
    `SELECT u.id, u.name, u.email, u.platform_role, u.status, u.created_at, u.last_seen_at,
       (SELECT w.name FROM memberships m JOIN workspaces w ON w.id = m.workspace_id
        WHERE m.user_id = u.id ORDER BY m.created_at, m.workspace_id LIMIT 1) AS workspace,
       (SELECT COUNT(*) FROM projects p JOIN memberships m ON m.workspace_id = p.workspace_id
        WHERE m.user_id = u.id AND m.role = 'owner') AS projects,
       (SELECT COUNT(*) FROM issue_reports i WHERE i.user_id = u.id AND i.status IN ('open', 'in_progress')) AS open_tickets
     FROM users u
     ORDER BY CASE u.status WHEN 'waiting' THEN 0 ELSE 1 END, u.created_at DESC`
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    role: asRole(r.platform_role),
    status: asStatus(r.status),
    workspace: r.workspace,
    projects: Number(r.projects),
    openTickets: Number(r.open_tickets),
    joinedAt: iso(r.created_at)!,
    lastSeenAt: iso(r.last_seen_at),
  }));
}

export async function listInvites(db: Db): Promise<PendingInvite[]> {
  const rows = await db.query<{
    id: string;
    email: string;
    name: string | null;
    platform_role: string;
    token: string;
    invited_by: string | null;
    created_at: Date | string;
    expires_at: Date | string;
  }>(
    `SELECT i.id, i.email, i.name, i.platform_role, i.token, i.created_at, i.expires_at,
            COALESCE(u.name, u.email) AS invited_by
     FROM invites i LEFT JOIN users u ON u.id = i.invited_by
     WHERE i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > NOW()
     ORDER BY i.created_at DESC`
  );
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    name: r.name,
    role: asRole(r.platform_role),
    token: r.token,
    invitedBy: r.invited_by,
    createdAt: iso(r.created_at)!,
    expiresAt: iso(r.expires_at)!,
  }));
}

export class UserAdminError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export interface NewInvite {
  email: string;
  name?: string;
  role: PlatformRole;
}

/**
 * Invites someone by email. Inviting the same address again renews the
 * invite (new link, new expiry, the role asked for now) instead of adding a
 * second one. Someone who already has an account needs no invite.
 */
export async function createInvite(db: Db, adminId: string, input: NewInvite): Promise<PendingInvite> {
  const email = input.email.trim().toLowerCase();
  const [existing] = await db.query("SELECT 1 FROM users WHERE LOWER(email) = $1", [email]);
  if (existing) throw new UserAdminError("That person already has an account. Find them in the list below.", 409);

  await db.query(
    `UPDATE invites SET revoked_at = NOW()
     WHERE LOWER(email) = $1 AND accepted_at IS NULL AND revoked_at IS NULL`,
    [email]
  );
  const token = randomBytes(24).toString("base64url");
  const [row] = await db.query<{ id: string }>(
    `INSERT INTO invites (email, name, platform_role, token, invited_by, expires_at)
     VALUES ($1, $2, $3, $4, $5, NOW() + make_interval(days => $6::int))
     RETURNING id`,
    [email, input.name?.trim() || null, input.role, token, adminId, INVITE_DAYS]
  );
  const invite = (await listInvites(db)).find((i) => i.id === row.id);
  if (!invite) throw new UserAdminError("The invite could not be saved", 500);
  return invite;
}

/** Stops an invite link working. False when there was no such open invite. */
export async function revokeInvite(db: Db, inviteId: string): Promise<boolean> {
  const rows = await db.query(
    "UPDATE invites SET revoked_at = NOW() WHERE id = $1 AND accepted_at IS NULL AND revoked_at IS NULL RETURNING id",
    [inviteId]
  );
  return rows.length > 0;
}

export interface UserChange {
  role?: PlatformRole;
  /** 'active' lets a waiting person in, or switches a disabled one back on. */
  status?: Exclude<UserStatus, "waiting">;
}

/**
 * Changes someone's role or switches them off or on. The Admin cannot take
 * their own role away or switch themselves off, so the platform always keeps
 * an Admin who can undo a change.
 */
export async function updateUser(db: Db, adminId: string, userId: string, change: UserChange): Promise<ManagedUser> {
  if (userId === adminId && (change.role === "user" || change.status === "disabled")) {
    throw new UserAdminError("You can't remove your own Admin access or switch yourself off.");
  }
  const rows = await db.query(
    `UPDATE users SET
       platform_role = COALESCE($2, platform_role),
       status = COALESCE($3, status),
       status_changed_by = CASE WHEN $3::text IS NULL THEN status_changed_by ELSE $4 END,
       updated_at = NOW()
     WHERE id = $1 RETURNING id`,
    [userId, change.role ?? null, change.status ?? null, adminId]
  );
  if (!rows.length) throw new UserAdminError("No such person", 404);
  const user = (await listUsers(db)).find((u) => u.id === userId);
  if (!user) throw new UserAdminError("No such person", 404);
  return user;
}

export interface AccessSettings {
  inviteOnly: boolean;
}

export async function readAccess(db: Db): Promise<AccessSettings> {
  const [row] = await db.query<{ invite_only: boolean }>("SELECT invite_only FROM platform_access LIMIT 1");
  return { inviteOnly: Boolean(row?.invite_only) };
}

/** Invite only: new sign-ups without an invite wait for the Admin. Existing people are not affected. */
export async function saveAccess(db: Db, adminId: string, settings: AccessSettings): Promise<AccessSettings> {
  await db.query(
    `INSERT INTO platform_access (id, invite_only, updated_by, updated_at) VALUES (TRUE, $1, $2, NOW())
     ON CONFLICT (id) DO UPDATE SET invite_only = EXCLUDED.invite_only, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [settings.inviteOnly, adminId]
  );
  return readAccess(db);
}
