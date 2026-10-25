import { getDb } from "@/lib/db";
import { json, preflight } from "@/lib/mcp/http";
import { OAuthError, registerClient } from "@/lib/mcp/oauth";

export const dynamic = "force-dynamic";

/** RFC 7591: an AI app registers itself before signing her in. Public clients only (PKCE, no secret). */
export async function POST(req: Request) {
  const db = getDb();
  if (!db) return json({ error: "temporarily_unavailable", error_description: "This deployment has no server storage" }, 503);
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return json({ error: "invalid_client_metadata", error_description: "Send the client's metadata as JSON" }, 400);
  try {
    const client = await registerClient(db, body);
    return json(
      {
        client_id: client.clientId,
        client_id_issued_at: Math.floor(Date.now() / 1000),
        client_name: client.name,
        redirect_uris: client.redirectUris,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      },
      201
    );
  } catch (err) {
    if (err instanceof OAuthError) return json({ error: err.code, error_description: err.message }, 400);
    throw err;
  }
}

export const OPTIONS = preflight;
