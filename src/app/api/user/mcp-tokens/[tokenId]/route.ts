import { NextResponse } from "next/server";
import { revokeToken } from "@/lib/mcp/tokens";
import { requireWorkspace } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";

/** Revokes a token or an app's login: it stops working at once. */
export async function DELETE(_req: Request, ctx: { params: Promise<{ tokenId: string }> }) {
  const ws = await requireWorkspace();
  if (ws instanceof NextResponse) return ws;
  if (!(await revokeToken(ws.db, ws.user.id, (await ctx.params).tokenId))) return NextResponse.json({ error: "No such token" }, { status: 404 });
  return NextResponse.json({ revoked: true });
}
