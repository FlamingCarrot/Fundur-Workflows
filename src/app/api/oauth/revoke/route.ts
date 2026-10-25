import { getDb } from "@/lib/db";
import { json, preflight, readForm } from "@/lib/mcp/http";
import { revokeBySecret } from "@/lib/mcp/tokens";

export const dynamic = "force-dynamic";

/** RFC 7009: an app signing out. Always 200, so it says nothing about which tokens exist. */
export async function POST(req: Request) {
  const db = getDb();
  if (!db) return json({ error: "temporarily_unavailable" }, 503);
  const { token } = await readForm(req);
  if (token) await revokeBySecret(db, token);
  return json({});
}

export const OPTIONS = preflight;
