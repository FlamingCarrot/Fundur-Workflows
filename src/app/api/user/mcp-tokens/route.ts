import { NextResponse } from "next/server";
import { z } from "zod";
import { createPersonalToken, listTokens } from "@/lib/mcp/tokens";
import { publicOrigin } from "@/lib/mcp/http";
import { requireFeature, requirePermission, requireWorkspace } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";

/** Her personal access tokens and app logins for the MCP server, and its address. */
export async function GET(req: Request) {
  const ws = await requireWorkspace();
  if (ws instanceof NextResponse) return ws;
  return NextResponse.json({ url: `${publicOrigin(req)}/api/mcp`, tokens: await listTokens(ws.db, ws.user.id) });
}

const input = z.object({ name: z.string().trim().min(1).max(100), canConfirm: z.boolean().default(false) });

/** A new personal token, for the workspace she is in. The secret comes back once, here, and is never shown again. */
export async function POST(req: Request) {
  const ws = await requireWorkspace();
  if (ws instanceof NextResponse) return ws;
  const denied = requirePermission(ws, "ai:use") ?? requireFeature(ws, "ai");
  if (denied) return denied;
  const parsed = input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Give the token a name" }, { status: 400 });
  const made = await createPersonalToken(ws.db, { userId: ws.user.id, workspaceId: ws.workspaceId, name: parsed.data.name, canConfirm: parsed.data.canConfirm });
  return NextResponse.json({ token: made.token, view: made.view }, { status: 201 });
}
