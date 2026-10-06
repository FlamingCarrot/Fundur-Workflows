import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { openAlerts } from "@/lib/ai/budget";
import { listMessages, type ChatAttachment } from "@/lib/ai/chat-store";
import { runTurn, type StreamEvent } from "@/lib/ai/orchestrator";
import { readDefaultModel } from "@/lib/ai/settings";
import { getProject, projectDbId } from "@/lib/projects/store";
import { requireWorkspace } from "@/lib/server/workspace-context";
import { projectTasks } from "@/lib/studio/tasks";
import { isInProject, isStorageConfigured, readFileBytes, statFile } from "@/lib/storage/blob";

export const dynamic = "force-dynamic";
// A reply that runs several tools, with review, can take a few minutes.
export const maxDuration = 300;

async function context(slug: string) {
  const ws = await requireWorkspace();
  if (ws instanceof NextResponse) return ws;
  const project = await getProject(ws.db, ws.workspaceId, slug);
  const projectId = project && (await projectDbId(ws.db, ws.workspaceId, slug));
  if (!project || !projectId) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  return { ...ws, project, projectId };
}

/** The project's conversation, its open budget alerts, and whether a model is set up. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const pc = await context((await ctx.params).id);
  if (pc instanceof NextResponse) return pc;
  return NextResponse.json({
    messages: await listMessages(pc.db, pc.workspaceId, pc.projectId),
    alerts: await openAlerts(pc.db, pc.workspaceId, pc.projectId),
    configured: !!(await readDefaultModel(pc.db)),
    isAdmin: pc.user.platformRole === "admin",
    fileStorage: isStorageConfigured(),
  });
}

const turnInput = z.object({
  text: z.string().max(20_000),
  attachments: z
    .array(
      z.object({
        storageKey: z.string().min(1).max(600),
        name: z.string().min(1).max(255),
        contentType: z.string().max(255).optional(),
      })
    )
    .max(10)
    .default([]),
  phaseKey: z.string().max(100).optional(),
  taskId: z.string().max(100).optional(),
});

/**
 * Sends her message and streams the reply (P4-10) as lines of JSON: words as
 * they are written, tools as they run, proposed changes, and the reply's cost.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const pc = await context((await ctx.params).id);
  if (pc instanceof NextResponse) return pc;
  const parsed = turnInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Send a message" }, { status: 400 });
  const input = parsed.data;
  if (!input.text.trim() && !input.attachments.length) return NextResponse.json({ error: "Send a message" }, { status: 400 });
  if (input.taskId && !projectTasks(pc.project).some((t) => t.id === input.taskId)) input.taskId = undefined;

  // Files must sit in this project's folder and have finished uploading; sizes come from storage.
  const attachments: ChatAttachment[] = [];
  for (const a of input.attachments) {
    if (!isInProject(a.storageKey, pc.workspaceId, pc.projectId)) {
      return NextResponse.json({ error: "That file belongs to another project" }, { status: 400 });
    }
    const stored = await statFile(a.storageKey);
    if (!stored) return NextResponse.json({ error: `${a.name} did not finish uploading` }, { status: 400 });
    attachments.push({ ...a, sizeBytes: stored.size, contentType: a.contentType || stored.contentType });
  }

  const readFile = (key: string) => (isInProject(key, pc.workspaceId, pc.projectId) ? readFileBytes(key) : Promise.resolve(null));
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: StreamEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
      try {
        await runTurn(
          { db: pc.db, workspaceId: pc.workspaceId, projectId: pc.projectId, userId: pc.user.id, project: pc.project, readFile },
          { text: input.text.trim(), attachments, phaseKey: input.phaseKey, taskId: input.taskId },
          send
        );
      } catch (err) {
        console.error("Chat turn failed", err);
        send({ type: "error", error: "Something went wrong answering this. Try again." });
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store, no-transform" },
  });
}
