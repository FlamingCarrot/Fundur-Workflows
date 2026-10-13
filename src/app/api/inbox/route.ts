import { NextResponse } from "next/server";
import { readInbox } from "@/lib/autopilot/inbox";
import { runDueAfterResponse } from "@/lib/autopilot/server";
import { accessibleProjectSlugs, requireWorkspace } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Her inbox across the workspace's projects. Opening it also wakes any
 * autopilot that is due a look, after the response has gone.
 */
export async function GET() {
  const ws = await requireWorkspace();
  if (ws instanceof NextResponse) return ws;
  if (ws.workspaceRole === "collaborator" || !ws.features.ai) return NextResponse.json({ projects: [], asks: [], review: [], done: [] });
  const inbox = await readInbox(ws.db, ws.workspaceId, await accessibleProjectSlugs(ws));
  runDueAfterResponse(ws.db, ws.workspaceId);
  return NextResponse.json(inbox);
}
