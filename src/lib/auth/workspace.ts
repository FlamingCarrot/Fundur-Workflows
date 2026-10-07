import { createHash } from "crypto";
import type { Db } from "@/lib/db";

export interface SignedInUser {
  /** The Auth0 user id, e.g. "auth0|123" or "google-oauth2|456". */
  sub: string;
  email?: string | null;
  name?: string | null;
  picture?: string | null;
}

/**
 * The workspace a signed-in person works in. Someone signing in for the first
 * time gets a workspace of their own, with them as its owner. Invitations add further memberships after the invited email is verified;
 * selection of those memberships is checked in workspace-context.
 */
export async function ensureWorkspace(db: Db, user: SignedInUser): Promise<string> {
  const existing = await db.query<{ workspace_id: string }>(
    "SELECT workspace_id FROM memberships WHERE user_id = $1 ORDER BY created_at, workspace_id LIMIT 1",
    [user.sub]
  );
  if (existing.length) return existing[0].workspace_id;

  await db.query(
    `INSERT INTO users (id, email, name, avatar_url) VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name,
       avatar_url = EXCLUDED.avatar_url, updated_at = NOW()`,
    [user.sub, user.email ?? null, user.name ?? null, user.picture ?? null]
  );

  // The slug comes from the user id, so two first requests at once land on the same workspace.
  const slug = `personal-${createHash("sha256").update(user.sub).digest("hex").slice(0, 20)}`;
  const label = user.name || user.email || "My";
  const [workspace] = await db.query<{ id: string }>(
    `INSERT INTO workspaces (name, slug) VALUES ($1, $2)
     ON CONFLICT (slug) DO UPDATE SET slug = EXCLUDED.slug
     RETURNING id`,
    [`${label}'s studio`.slice(0, 255), slug]
  );
  await db.query(
    `INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner')
     ON CONFLICT (workspace_id, user_id) DO NOTHING`,
    [workspace.id, user.sub]
  );
  return workspace.id;
}
