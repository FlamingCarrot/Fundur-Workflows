import { after, NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { listMessages, replaceFrom } from "@/lib/ai/chat-store";
import { noteTask, notesFor } from "@/lib/ai/memory";
import { effectiveRoleModels } from "@/lib/ai/auto-models";
import { assistantContext } from "@/lib/ai/context";
import { runStudioTurn, studioSuggestions, type StreamEvent } from "@/lib/ai/orchestrator";
import { requireFeature, requirePermission, requireWorkspace } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Her own conversation with the assistant outside any project: the design library, her planner, anywhere. */
async function context() {
  const ws = await requireWorkspace();
  if (ws instanceof NextResponse) return ws;
  return requirePermission(ws, "ai:use") ?? requireFeature(ws, "ai") ?? ws;
}

export async function GET(req: NextRequest) {
  const ws = await context();
  if (ws instanceof NextResponse) return ws;
  const isAdmin = ws.user.platformRole === "admin";
  const page = req.nextUrl.searchParams.get("page");
  const messages = await listMessages(ws.db, ws.workspaceId, null, 100, { isAdmin, userId: ws.user.id });
  const notes = await notesFor(ws.db, ws.workspaceId, messages.filter((m) => m.role === "assistant").map((m) => m.id));
  return NextResponse.json({
    messages: messages.map((m) => (notes.has(m.id) ? { ...m, note: notes.get(m.id) } : m)),
    alerts: [],
    configured: !!(await effectiveRoleModels(ws.db)).roles.orchestrator,
    isAdmin,
    fileStorage: false,
    suggestions: studioSuggestions({ page: page === "library" || page === "planner" ? page : "other", selection: [], blueprintId: req.nextUrl.searchParams.get("blueprint") ?? undefined }),
  });
}

const turnInput = z.object({ text: z.string().max(20_000), context: assistantContext.optional(), replaces: z.string().uuid().optional(), memory: z.boolean().default(true) });

export async function POST(req: NextRequest) {
  const ws = await context();
  if (ws instanceof NextResponse) return ws;
  const parsed = turnInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !parsed.data.text.trim()) return NextResponse.json({ error: "Send a message" }, { status: 400 });
  if (parsed.data.replaces && !(await replaceFrom(ws.db, ws.workspaceId, null, ws.user.id, parsed.data.replaces))) {
    return NextResponse.json({ error: "That message can't be changed any more. Reload the chat and try again." }, { status: 409 });
  }
  // After the reply has reached her, the assistant writes its note on the task and keeps what it learned.
  let started: string | null = null;
  let turnFinished: (ok: boolean) => void = () => {};
  const finished = new Promise<boolean>((resolve) => (turnFinished = resolve));
  after(async () => {
    if (!(await finished) || !started || !parsed.data.memory) return;
    await noteTask(ws.db, { workspaceId: ws.workspaceId, projectId: null, userId: ws.user.id, messageId: started, ask: parsed.data.text.trim() }).catch((err) =>
      console.error("Task note failed", err instanceof Error ? err.message : "unknown")
    );
  });
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (e: StreamEvent) => {
        if (e.type === "start") started = e.messageId;
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
        } catch {
          open = false;
        }
      };
      try {
        await runStudioTurn(
          { db: ws.db, workspaceId: ws.workspaceId, userId: ws.user.id, isAdmin: ws.user.platformRole === "admin", signal: req.signal, features: ws.features },
          { text: parsed.data.text.trim(), context: parsed.data.context, memory: parsed.data.memory },
          send
        );
        turnFinished(true);
      } catch (err) {
        console.error("Studio chat turn failed", err);
        send({ type: "error", error: "Something went wrong answering this. Try again." });
      }
      turnFinished(false);
      if (open) controller.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store, no-transform" } });
}
