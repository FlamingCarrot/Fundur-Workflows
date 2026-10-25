import { getDb } from "@/lib/db";
import { json, preflight, readForm } from "@/lib/mcp/http";
import { exchange, OAuthError } from "@/lib/mcp/oauth";

export const dynamic = "force-dynamic";

/** The token endpoint: a one-time code (with PKCE) or a refresh token, for an access token. */
export async function POST(req: Request) {
  const db = getDb();
  if (!db) return json({ error: "temporarily_unavailable" }, 503);
  try {
    return json(await exchange(db, await readForm(req)));
  } catch (err) {
    if (err instanceof OAuthError) return json({ error: err.code, error_description: err.message }, err.code === "invalid_client" ? 401 : 400);
    throw err;
  }
}

export const OPTIONS = preflight;
