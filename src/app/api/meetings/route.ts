import { NextResponse } from "next/server";
import { accessibleProjectSlugs, requireWorkspace } from "@/lib/server/workspace-context";
import { accessByProject } from "@/lib/team/store";
import { canUseTool } from "@/lib/team/access";
import { meetingsBetween } from "@/lib/comms/store";
import { COMMS_TOOL } from "@/lib/comms/http";
export const dynamic = "force-dynamic";

/** Meetings across every project this person can open, between ?from and ?to: for the calendar. */
export async function GET(req: Request) {
  const ctx = await requireWorkspace();
  if (ctx instanceof NextResponse) return ctx;
  const url = new URL(req.url);
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";
  if (Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to)) || Date.parse(to) - Date.parse(from) > 400 * 86_400_000)
    return NextResponse.json({ error: "Give a range of up to a year" }, { status: 400 });
  const access = await accessByProject(ctx.db, ctx.workspaceId, ctx.user.id, ctx.workspaceRole);
  // Null means every project of the workspace.
  const open =
    (await accessibleProjectSlugs(ctx)) ??
    (await ctx.db.query<{ slug: string }>("SELECT slug FROM projects WHERE workspace_id=$1", [ctx.workspaceId])).map((r) => r.slug);
  const slugs = open.filter((slug) => canUseTool(access.get(slug), COMMS_TOOL));
  return NextResponse.json({ meetings: await meetingsBetween(ctx.db, ctx.workspaceId, slugs, from, to, ctx.user.id) }, { headers: { "Cache-Control": "private, no-store" } });
}
