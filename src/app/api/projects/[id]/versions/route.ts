import { NextRequest, NextResponse } from "next/server";
import { listVersions } from "@/lib/projects/store";
import { requireWorkspace } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";

/** The project's phase snapshots and the version history of its files. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const ws = await requireWorkspace();
  if (ws instanceof NextResponse) return ws;
  const versions = await listVersions(ws.db, ws.workspaceId, (await ctx.params).id);
  if (!versions) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  return NextResponse.json(versions);
}
