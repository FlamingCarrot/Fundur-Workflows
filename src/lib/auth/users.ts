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

export interface AppUser {
  id: string;
  name: string | null;
  email: string | null;
  platformRole: PlatformRole;
}

/** True when this sign-in should hold the Admin role. */
export function qualifiesAsAdmin(user: SessionUser): boolean {
  const email = user.email?.trim().toLowerCase();
  return Boolean(email && user.email_verified === true && adminEmails().includes(email));
}

/**
 * Records the signed-in person and returns their platform role. Admin is
 * granted here and kept by user id; it is never taken away by a later sign-in,
 * only by changing the row.
 */
export async function syncUser(db: Db, user: SessionUser): Promise<AppUser> {
  const [row] = await db.query<{ platform_role: string }>(
    `INSERT INTO users (id, email, name, avatar_url, platform_role)
     VALUES ($1, $2, $3, $4, CASE WHEN $5::boolean THEN 'admin' ELSE 'user' END)
     ON CONFLICT (id) DO UPDATE SET
       email = EXCLUDED.email, name = EXCLUDED.name, avatar_url = EXCLUDED.avatar_url,
       platform_role = CASE WHEN $5::boolean THEN 'admin' ELSE users.platform_role END,
       updated_at = NOW()
     RETURNING platform_role`,
    [user.sub, user.email ?? null, user.name ?? null, user.picture ?? null, qualifiesAsAdmin(user)]
  );
  return {
    id: user.sub,
    name: user.name ?? null,
    email: user.email ?? null,
    platformRole: row.platform_role === "admin" ? "admin" : "user",
  };
}
