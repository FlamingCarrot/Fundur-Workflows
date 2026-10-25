import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Db } from "@/lib/db";

/**
 * Access tokens for the MCP server. A personal token is made by hand in
 * settings and kept until she revokes it; an OAuth login is made when an app
 * (Claude, ChatGPT…) signs in, and lasts a day, renewed with its refresh token.
 * Only a SHA-256 hash of each secret is stored: a leaked database gives nobody
 * a way in.
 */

export const PERSONAL_PREFIX = "fdr_pat_";
export const ACCESS_PREFIX = "fdr_at_";
export const REFRESH_PREFIX = "fdr_rt_";
/** How long an OAuth access token lasts, and its refresh token. */
export const ACCESS_TTL_SECONDS = 24 * 60 * 60;
export const REFRESH_TTL_DAYS = 90;

export type TokenKind = "personal" | "oauth";

export interface TokenView {
  id: string;
  name: string;
  kind: TokenKind;
  prefix: string;
  workspaceId: string;
  workspaceName: string | null;
  canConfirm: boolean;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
}

/** The person and workspace a token acts for. */
export interface TokenOwner {
  tokenId: string;
  name: string;
  kind: TokenKind;
  userId: string;
  workspaceId: string;
  canConfirm: boolean;
}

export const hashSecret = (secret: string) => createHash("sha256").update(secret).digest("hex");
export const newSecret = (prefix: string) => prefix + randomBytes(32).toString("base64url");

/** True when a PKCE verifier matches the S256 challenge the app sent first. */
export function pkceMatches(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  const made = Buffer.from(createHash("sha256").update(verifier).digest("base64url"));
  const sent = Buffer.from(challenge);
  return made.length === sent.length && timingSafeEqual(made, sent);
}

interface TokenRow {
  id: string;
  name: string;
  kind: string;
  prefix: string;
  workspace_id: string;
  workspace_name?: string | null;
  can_confirm: boolean;
  created_at: Date | string;
  last_used_at: Date | string | null;
  expires_at: Date | string | null;
}
const iso = (v: Date | string | null) => (v == null ? null : new Date(v).toISOString());
const view = (r: TokenRow): TokenView => ({
  id: r.id,
  name: r.name,
  kind: r.kind === "oauth" ? "oauth" : "personal",
  prefix: r.prefix,
  workspaceId: r.workspace_id,
  workspaceName: r.workspace_name ?? null,
  canConfirm: !!r.can_confirm,
  createdAt: iso(r.created_at)!,
  lastUsedAt: iso(r.last_used_at),
  expiresAt: iso(r.expires_at),
});

/** Makes a personal token; the secret is shown to her once and never again. */
export async function createPersonalToken(
  db: Db,
  input: { userId: string; workspaceId: string; name: string; canConfirm?: boolean }
): Promise<{ token: string; view: TokenView }> {
  const token = newSecret(PERSONAL_PREFIX);
  const [row] = await db.query<TokenRow>(
    `INSERT INTO mcp_tokens (user_id, workspace_id, name, kind, token_hash, prefix, can_confirm)
     VALUES ($1, $2, $3, 'personal', $4, $5, $6)
     RETURNING id, name, kind, prefix, workspace_id, can_confirm, created_at, last_used_at, expires_at`,
    [input.userId, input.workspaceId, input.name.trim().slice(0, 100) || "Personal token", hashSecret(token), token.slice(0, PERSONAL_PREFIX.length + 4), !!input.canConfirm]
  );
  return { token, view: view(row) };
}

/** An OAuth login for an app: a day's access token and a refresh token. */
export async function createOAuthToken(
  db: Db,
  input: { userId: string; workspaceId: string; clientId: string; name: string; canConfirm: boolean }
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
  const accessToken = newSecret(ACCESS_PREFIX);
  const refreshToken = newSecret(REFRESH_PREFIX);
  await db.query(
    `INSERT INTO mcp_tokens (user_id, workspace_id, name, kind, client_id, token_hash, refresh_hash, prefix, can_confirm, expires_at, refresh_expires_at)
     VALUES ($1, $2, $3, 'oauth', $4, $5, $6, $7, $8, NOW() + $9::int * INTERVAL '1 second', NOW() + $10::int * INTERVAL '1 day')`,
    [
      input.userId,
      input.workspaceId,
      input.name.slice(0, 100),
      input.clientId,
      hashSecret(accessToken),
      hashSecret(refreshToken),
      accessToken.slice(0, ACCESS_PREFIX.length + 4),
      input.canConfirm,
      ACCESS_TTL_SECONDS,
      REFRESH_TTL_DAYS,
    ]
  );
  return { accessToken, refreshToken, expiresIn: ACCESS_TTL_SECONDS };
}

/**
 * Swaps a refresh token for a new pair on the same login. The old refresh
 * token stops working at once, so a stolen one is good for one use at most.
 */
export async function refreshOAuthToken(
  db: Db,
  refreshToken: string,
  clientId: string
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number } | null> {
  const accessToken = newSecret(ACCESS_PREFIX);
  const next = newSecret(REFRESH_PREFIX);
  const rows = await db.query<{ id: string }>(
    `UPDATE mcp_tokens SET token_hash = $3, refresh_hash = $4, prefix = $5,
       expires_at = NOW() + $6::int * INTERVAL '1 second', refresh_expires_at = NOW() + $7::int * INTERVAL '1 day'
     WHERE refresh_hash = $1 AND client_id = $2 AND kind = 'oauth' AND revoked_at IS NULL AND refresh_expires_at > NOW()
     RETURNING id`,
    [hashSecret(refreshToken), clientId, hashSecret(accessToken), hashSecret(next), accessToken.slice(0, ACCESS_PREFIX.length + 4), ACCESS_TTL_SECONDS, REFRESH_TTL_DAYS]
  );
  return rows.length ? { accessToken, refreshToken: next, expiresIn: ACCESS_TTL_SECONDS } : null;
}

/** Who a bearer token acts for, or null when it is unknown, revoked or expired. Notes when it was used. */
export async function verifyToken(db: Db, token: string): Promise<TokenOwner | null> {
  if (!token.startsWith(PERSONAL_PREFIX) && !token.startsWith(ACCESS_PREFIX)) return null;
  const [row] = await db.query<{ id: string; name: string; kind: string; user_id: string; workspace_id: string; can_confirm: boolean; last_used_at: Date | string | null }>(
    `SELECT id, name, kind, user_id, workspace_id, can_confirm, last_used_at FROM mcp_tokens
     WHERE token_hash = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())`,
    [hashSecret(token)]
  );
  if (!row) return null;
  // Written at most once a minute: every tool call would otherwise write a row.
  if (!row.last_used_at || Date.now() - new Date(row.last_used_at).getTime() > 60_000) {
    await db.query("UPDATE mcp_tokens SET last_used_at = NOW() WHERE id = $1", [row.id]);
  }
  return {
    tokenId: row.id,
    name: row.name,
    kind: row.kind === "oauth" ? "oauth" : "personal",
    userId: row.user_id,
    workspaceId: row.workspace_id,
    canConfirm: !!row.can_confirm,
  };
}

/** Her tokens and app logins that still work, newest first. */
export async function listTokens(db: Db, userId: string): Promise<TokenView[]> {
  const rows = await db.query<TokenRow>(
    `SELECT t.id, t.name, t.kind, t.prefix, t.workspace_id, w.name AS workspace_name, t.can_confirm, t.created_at, t.last_used_at,
            CASE WHEN t.kind = 'oauth' THEN t.refresh_expires_at ELSE t.expires_at END AS expires_at
     FROM mcp_tokens t JOIN workspaces w ON w.id = t.workspace_id
     WHERE t.user_id = $1 AND t.revoked_at IS NULL
       AND (t.kind = 'personal' OR t.refresh_expires_at > NOW())
     ORDER BY t.created_at DESC`,
    [userId]
  );
  return rows.map(view);
}

/** Stops a token or app login working; false when it was not hers or already revoked. */
export async function revokeToken(db: Db, userId: string, tokenId: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(tokenId)) return false;
  const rows = await db.query("UPDATE mcp_tokens SET revoked_at = NOW() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL RETURNING id", [tokenId, userId]);
  return rows.length > 0;
}

/** RFC 7009: an app signing out. Takes either of its tokens; unknown tokens are ignored. */
export async function revokeBySecret(db: Db, secret: string): Promise<void> {
  const hash = hashSecret(secret);
  await db.query("UPDATE mcp_tokens SET revoked_at = NOW() WHERE (token_hash = $1 OR refresh_hash = $1) AND revoked_at IS NULL", [hash]);
}
