import { NextRequest, NextResponse } from "next/server";
import type { StreamEvent } from "@/lib/ai/orchestrator";
import { runAutopilot, type RunOutcome } from "@/lib/autopilot/run";
import { projectFileReader } from "@/lib/autopilot/server";
import { projectDbId } from "@/lib/projects/store";
import { requireProject } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Run now: the autopilot works through the project's agenda straight away,
 * streaming what it does as lines of JSON (the chat's own events), then the
 * run's outcome. It finishes even if she leaves the page.
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const slug = (await ctx.params).id;
  const ws = await requireProject(slug, "ai:use", "ai");
  if (ws instanceof NextResponse) return ws;
  const projectId = await projectDbId(ws.db, ws.workspaceId, slug);
  if (!projectId) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (e: StreamEvent | { type: "outcome"; outcome: RunOutcome }) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
        } catch {
          open = false;
        }
      };
      try {
        const outcome = await runAutopilot({
          db: ws.db,
          workspaceId: ws.workspaceId,
          projectId,
          slug,
          userId: ws.user.id,
          trigger: "manual",
          isAdmin: ws.user.platformRole === "admin",
          readFile: projectFileReader(ws.workspaceId, projectId),
          emit: send,
        });
        send({ type: "outcome", outcome });
      } catch (err) {
        console.error("Autopilot run failed", err);
        send({ type: "error", error: "The autopilot hit a problem. Try again." });
      }
      if (open) controller.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store, no-transform" } });
}
