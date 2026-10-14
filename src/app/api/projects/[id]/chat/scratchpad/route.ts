import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { updateLatestScratchpad } from "@/lib/ai/chat-store";
import { getProject, projectDbId } from "@/lib/projects/store";
import { requireProject } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";

const scratchpadInput = z.object({
  scratchpad: z
    .object({
      title: z.string().min(1).max(200),
      tasks: z.array(
        z.object({
          id: z.string().max(100),
          text: z.string().max(300),
          status: z.enum(["pending", "in_progress", "completed", "failed"]),
          note: z.string().max(300).optional(),
        })
      ),
    })
    .nullable(),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const slug = (await ctx.params).id;
  const ws = await requireProject(slug, "ai:use", "ai");
  if (ws instanceof NextResponse) return ws;
  const project = await getProject(ws.db, ws.workspaceId, slug);
  const projectId = project && (await projectDbId(ws.db, ws.workspaceId, slug));
  if (!project || !projectId) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const parsed = scratchpadInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid scratchpad" }, { status: 400 });

  await updateLatestScratchpad(ws.db, ws.workspaceId, projectId, ws.user.id, parsed.data.scratchpad);
  return NextResponse.json({ ok: true });
}
