import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { openAlerts } from "@/lib/ai/budget";
import { listMessages, replaceFrom, type ChatAttachment } from "@/lib/ai/chat-store";
import { runTurn, type StreamEvent } from "@/lib/ai/orchestrator";
import { effectiveRoleModels } from "@/lib/ai/auto-models";
import { assistantContext, PAGES, type AssistantPage } from "@/lib/ai/context";
import { nextSteps } from "@/lib/ai/next-steps";
import { getPlanState } from "@/lib/plan/store";
import { getProject, projectDbId } from "@/lib/projects/store";
import { requireProject } from "@/lib/server/workspace-context";
import { projectTasks } from "@/lib/studio/tasks";
import { isInProject, isStorageConfigured, readFileBytes, statFile } from "@/lib/storage/blob";

export const dynamic = "force-dynamic";
// A reply that runs several tools, with review, can take a few minutes.
export const maxDuration = 300;

async function context(slug: string) {
  const ws = await requireProject(slug, "ai:use", "ai");
  if (ws instanceof NextResponse) return ws;
  const project = await getProject(ws.db, ws.workspaceId, slug);
  const projectId = project && (await projectDbId(ws.db, ws.workspaceId, slug));
  if (!project || !projectId) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  return { ...ws, project, projectId };
}

/**
 * The project's conversation, its open budget alerts, whether a model is set
 * up, and the next steps to suggest on the page she is on (?page=plan).
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const pc = await context((await ctx.params).id);
  if (pc instanceof NextResponse) return pc;
  const isAdmin = pc.user.platformRole === "admin";
  const asked = req.nextUrl.searchParams.get("page");
  const page: AssistantPage = (PAGES as readonly string[]).includes(asked ?? "") ? (asked as AssistantPage) : "other";
  const plan = await getPlanState(pc.db, pc.workspaceId, pc.project.id);
  const alerts = await openAlerts(pc.db, pc.workspaceId, pc.projectId);
  return NextResponse.json({
    messages: await listMessages(pc.db, pc.workspaceId, pc.projectId, 100, { isAdmin, viewerId: pc.user.id }),
    alerts: isAdmin ? alerts : alerts.map((a) => ({ ...a, spendZar: 0, budgetZar: 0 })),
    configured: !!(await effectiveRoleModels(pc.db)).roles.orchestrator,
    isAdmin,
    fileStorage: isStorageConfigured(),
    suggestions: nextSteps(pc.project, plan?.plan ?? null, { page, selection: [], levelId: req.nextUrl.searchParams.get("level") ?? undefined }),
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
  context: assistantContext.optional(),
  autoApply: z.boolean().default(true),
  /** Her earlier message this one replaces, with everything after it (an edit, or asking again). */
  replaces: z.string().uuid().optional(),
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

  if (input.replaces && !(await replaceFrom(pc.db, pc.workspaceId, pc.projectId, pc.user.id, input.replaces))) {
    return NextResponse.json({ error: "That message can't be changed any more. Reload the chat and try again." }, { status: 409 });
  }

  const readFile = (key: string) => (isInProject(key, pc.workspaceId, pc.projectId) ? readFileBytes(key) : Promise.resolve(null));
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      // After Stop the browser has gone; the turn finishes its step and is saved, but nothing more is sent.
      const send = (e: StreamEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
        } catch {
          open = false;
        }
      };
      try {
        await runTurn(
          {
            db: pc.db,
            workspaceId: pc.workspaceId,
            projectId: pc.projectId,
            userId: pc.user.id,
            project: pc.project,
            readFile,
            isAdmin: pc.user.platformRole === "admin",
            signal: req.signal,
            features: pc.features,
          },
          {
            text: input.text.trim(),
            attachments,
            phaseKey: input.phaseKey,
            taskId: input.taskId,
            context: input.context,
            autoApply: input.autoApply,
          },
          send
        );
      } catch (err) {
        console.error("Chat turn failed", err);
        send({ type: "error", error: "Something went wrong answering this. Try again." });
      }
      if (open) controller.close();
    },
  });
  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store, no-transform" },
  });
}
