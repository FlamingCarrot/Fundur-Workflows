import { NextResponse } from "next/server";
import { publicOrigin, readForm } from "@/lib/mcp/http";
import { issueCode, readAuthorizeRequest } from "@/lib/mcp/oauth";
import { memberships } from "@/lib/workspaces/store";
import { requireWorkspace } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";

/** Sends the app back with its answer: a code, or why not. */
function back(uri: string, params: Record<string, string | null>): NextResponse {
  const url = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
  return NextResponse.redirect(url.toString(), 303);
}

/**
 * Her answer on the /oauth/authorize page. Only from Fundur's own page: a
 * form posted from anywhere else is refused, so no site can approve an app in
 * her name.
 */
export async function POST(req: Request) {
  const origin = publicOrigin(req);
  const sentFrom = req.headers.get("origin");
  if (sentFrom && sentFrom !== origin && sentFrom !== new URL(req.url).origin) {
    return NextResponse.json({ error: "Approve the app on Fundur's own page" }, { status: 403 });
  }
  if (req.headers.get("sec-fetch-site") === "cross-site") return NextResponse.json({ error: "Approve the app on Fundur's own page" }, { status: 403 });
  const ws = await requireWorkspace();
  if (ws instanceof NextResponse) return ws;
  const form = await readForm(req);
  const read = await readAuthorizeRequest(ws.db, { ...form, response_type: "code", code_challenge_method: "S256" });
  if ("pageError" in read) return NextResponse.json({ error: read.pageError }, { status: 400 });
  if ("redirectError" in read) {
    const e = read.redirectError;
    return back(e.uri, { error: e.error, error_description: e.description, state: e.state });
  }
  const { client, redirectUri, codeChallenge, state } = read.ok;
  if (form.decision !== "allow") return back(redirectUri, { error: "access_denied", error_description: "The designer said no", state, iss: origin });
  const workspace = (await memberships(ws.db, ws.user.id)).find((w) => w.id === (form.workspace || ws.workspaceId));
  if (!workspace) return NextResponse.json({ error: "That workspace is not yours" }, { status: 403 });
  const code = await issueCode(ws.db, {
    clientId: client.clientId,
    userId: ws.user.id,
    workspaceId: workspace.id,
    redirectUri,
    codeChallenge,
    canConfirm: form.can_confirm === "on" || form.can_confirm === "true",
  });
  return back(redirectUri, { code, state, iss: origin });
}
