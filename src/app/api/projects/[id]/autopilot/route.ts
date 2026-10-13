import { NextRequest, NextResponse } from "next/server";
import { autopilotPatch, getAutopilot, listRuns, projectAsks, saveAutopilot } from "@/lib/autopilot/store";
import { autopilotAgenda } from "@/lib/autopilot/model";
import { getProject, projectDbId } from "@/lib/projects/store";
import { requireProject } from "@/lib/server/workspace-context";
import { runAfterResponse } from "@/lib/autopilot/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** The project's autopilot: its settings, what it would look at now, its recent runs and its open questions. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const slug = (await ctx.params).id;
  const ws = await requireProject(slug, "ai:use", "ai");
  if (ws instanceof NextResponse) return ws;
  const project = await getProject(ws.db, ws.workspaceId, slug);
  const projectId = await projectDbId(ws.db, ws.workspaceId, slug);
  if (!project || !projectId) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  const state = await getAutopilot(ws.db, projectId);
  const asks = await projectAsks(ws.db, projectId, "all", 30);
  return NextResponse.json({
    state,
    agenda: autopilotAgenda(project, state.levels, { openAsks: asks.filter((a) => a.status === "open") }),
    runs: await listRuns(ws.db, projectId, 15),
    asks,
    canEdit: ws.workspaceRole === "owner" || ws.workspaceRole === "member",
  });
}

/** Turns it on or off, pauses it, or changes how often it looks and how much it does. */
export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const slug = (await ctx.params).id;
  const ws = await requireProject(slug, "project:edit", "ai");
  if (ws instanceof NextResponse) return ws;
  const parsed = autopilotPatch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Those settings did not fit" }, { status: 400 });
  const projectId = await projectDbId(ws.db, ws.workspaceId, slug);
  if (!projectId) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  const state = await saveAutopilot(ws.db, ws.workspaceId, projectId, ws.user.id, parsed.data);
  // Switched on or resumed: it takes a first look straight away.
  if (state.enabled && !state.paused && state.nextRunAt && new Date(state.nextRunAt).getTime() <= Date.now()) {
    runAfterResponse(ws.db, { workspaceId: ws.workspaceId, projectId, slug, userId: ws.user.id, trigger: "schedule" });
  }
  return NextResponse.json({ state });
}
