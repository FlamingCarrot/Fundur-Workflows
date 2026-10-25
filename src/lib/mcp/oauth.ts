import { randomBytes } from "node:crypto";
import type { Db } from "@/lib/db";
import { createOAuthToken, hashSecret, pkceMatches, refreshOAuthToken } from "./tokens";

/**
 * OAuth 2.1 for the MCP server, so an app like Claude or ChatGPT connects by
 * signing her in rather than by pasting a token. Apps register themselves
 * (RFC 7591), she approves them on Fundur's own page while signed in, and the
 * app swaps the one-time code for tokens with PKCE (S256). Only public
 * clients: there are no client secrets to leak.
 */

export interface OAuthClient {
  clientId: string;
  name: string;
  redirectUris: string[];
}

export class OAuthError extends Error {
  constructor(
    public code: "invalid_request" | "invalid_client" | "invalid_grant" | "unsupported_grant_type" | "invalid_redirect_uri" | "invalid_client_metadata",
    message: string
  ) {
    super(message);
  }
}

/**
 * Where an app may be sent back to: https anywhere, http only to this device
 * (loopback, for desktop apps), or an app's own scheme (cursor://, vscode://).
 * Never a scheme a browser would run or open as a file.
 */
export function allowedRedirect(uri: string): boolean {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.hash) return false;
  const scheme = url.protocol.slice(0, -1).toLowerCase();
  if (scheme === "https") return true;
  if (scheme === "http") return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (["javascript", "data", "vbscript", "file", "blob", "about", "ftp", "ws", "wss"].includes(scheme)) return false;
  return /^[a-z][a-z0-9+.-]*$/.test(scheme);
}

export async function registerClient(db: Db, input: { client_name?: unknown; redirect_uris?: unknown }): Promise<OAuthClient> {
  const uris = Array.isArray(input.redirect_uris) ? input.redirect_uris.filter((u): u is string => typeof u === "string") : [];
  if (!uris.length || uris.length > 10) throw new OAuthError("invalid_redirect_uri", "Give one to ten redirect_uris");
  const bad = uris.find((u) => u.length > 2000 || !allowedRedirect(u));
  if (bad) throw new OAuthError("invalid_redirect_uri", `Redirect URI not allowed: ${bad.slice(0, 200)}`);
  const name = (typeof input.client_name === "string" ? input.client_name : "").replace(/\s+/g, " ").trim().slice(0, 80) || "An AI app";
  const clientId = "fdr_client_" + randomBytes(16).toString("base64url");
  await db.query("INSERT INTO mcp_oauth_clients (client_id, name, redirect_uris) VALUES ($1, $2, $3::jsonb)", [clientId, name, JSON.stringify(uris)]);
  return { clientId, name, redirectUris: uris };
}

export async function getClient(db: Db, clientId: string): Promise<OAuthClient | null> {
  const [row] = await db.query<{ client_id: string; name: string; redirect_uris: unknown }>(
    "SELECT client_id, name, redirect_uris FROM mcp_oauth_clients WHERE client_id = $1",
    [clientId]
  );
  if (!row) return null;
  const uris = typeof row.redirect_uris === "string" ? JSON.parse(row.redirect_uris) : row.redirect_uris;
  return { clientId: row.client_id, name: row.name, redirectUris: Array.isArray(uris) ? uris : [] };
}

/** What an app asks for on the sign-in link, checked before she is shown anything. */
export interface AuthorizeRequest {
  client: OAuthClient;
  redirectUri: string;
  codeChallenge: string;
  state: string | null;
}

/**
 * Reads an /oauth/authorize link. A bad client or redirect is an error shown
 * on the page (never a redirect to somewhere unchecked); other problems go
 * back to the app.
 */
export async function readAuthorizeRequest(
  db: Db,
  params: Record<string, string | undefined>
): Promise<{ ok: AuthorizeRequest } | { pageError: string } | { redirectError: { uri: string; error: string; description: string; state: string | null } }> {
  const client = params.client_id ? await getClient(db, params.client_id) : null;
  if (!client) return { pageError: "This app is not registered with Fundur. Try connecting it again." };
  const redirectUri = params.redirect_uri ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : "");
  if (!client.redirectUris.includes(redirectUri)) return { pageError: "This app asked to be sent somewhere it did not register." };
  const state = params.state ?? null;
  const back = (error: string, description: string) => ({ redirectError: { uri: redirectUri, error, description, state } });
  if (params.response_type !== "code") return back("unsupported_response_type", "Only response_type=code is supported");
  if (!params.code_challenge || params.code_challenge_method !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(params.code_challenge)) {
    return back("invalid_request", "PKCE with code_challenge_method=S256 is required");
  }
  return { ok: { client, redirectUri, codeChallenge: params.code_challenge, state } };
}

/** The one-time code for an approved sign-in; good for five minutes. */
export async function issueCode(
  db: Db,
  input: { clientId: string; userId: string; workspaceId: string; redirectUri: string; codeChallenge: string; canConfirm: boolean }
): Promise<string> {
  const code = "fdr_code_" + randomBytes(32).toString("base64url");
  await db.query(
    `INSERT INTO mcp_oauth_codes (code_hash, client_id, user_id, workspace_id, redirect_uri, code_challenge, can_confirm, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW() + INTERVAL '5 minutes')`,
    [hashSecret(code), input.clientId, input.userId, input.workspaceId, input.redirectUri, input.codeChallenge, input.canConfirm]
  );
  return code;
}

export interface TokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
}

/** The token endpoint: an authorization code (with its PKCE verifier) or a refresh token for a fresh pair. */
export async function exchange(db: Db, form: Record<string, string | undefined>): Promise<TokenResponse> {
  const clientId = form.client_id ?? "";
  const client = clientId ? await getClient(db, clientId) : null;
  if (!client) throw new OAuthError("invalid_client", "Unknown client_id");
  const done = (t: { accessToken: string; refreshToken: string; expiresIn: number }): TokenResponse => ({
    access_token: t.accessToken,
    token_type: "Bearer",
    expires_in: t.expiresIn,
    refresh_token: t.refreshToken,
    scope: "mcp",
  });

  if (form.grant_type === "refresh_token") {
    if (!form.refresh_token) throw new OAuthError("invalid_request", "refresh_token is required");
    const next = await refreshOAuthToken(db, form.refresh_token, client.clientId);
    if (!next) throw new OAuthError("invalid_grant", "That refresh token is not valid any more. Connect the app again.");
    return done(next);
  }
  if (form.grant_type !== "authorization_code") throw new OAuthError("unsupported_grant_type", "Use authorization_code or refresh_token");
  if (!form.code || !form.code_verifier) throw new OAuthError("invalid_request", "code and code_verifier are required");
  // Claimed in one statement, so a code works once even when two requests race.
  const [row] = await db.query<{ user_id: string; workspace_id: string; redirect_uri: string; code_challenge: string; can_confirm: boolean }>(
    `UPDATE mcp_oauth_codes SET used_at = NOW()
     WHERE code_hash = $1 AND client_id = $2 AND used_at IS NULL AND expires_at > NOW()
     RETURNING user_id, workspace_id, redirect_uri, code_challenge, can_confirm`,
    [hashSecret(form.code), client.clientId]
  );
  if (!row) throw new OAuthError("invalid_grant", "That code is unknown, used or expired");
  if (form.redirect_uri && form.redirect_uri !== row.redirect_uri) throw new OAuthError("invalid_grant", "redirect_uri does not match");
  if (!pkceMatches(form.code_verifier, row.code_challenge)) throw new OAuthError("invalid_grant", "code_verifier does not match");
  const made = await createOAuthToken(db, { userId: row.user_id, workspaceId: row.workspace_id, clientId: client.clientId, name: client.name, canConfirm: !!row.can_confirm });
  return done(made);
}

/** The discovery documents (RFC 8414 and RFC 9728) apps read to find all of this. */
export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    revocation_endpoint: `${origin}/api/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["mcp"],
  };
}

export function protectedResourceMetadata(origin: string) {
  return {
    resource: `${origin}/api/mcp`,
    authorization_servers: [origin],
    bearer_methods_supported: ["header"],
    scopes_supported: ["mcp"],
    resource_name: "Fundur Workflows",
    resource_documentation: `${origin}/settings/connections`,
  };
}
