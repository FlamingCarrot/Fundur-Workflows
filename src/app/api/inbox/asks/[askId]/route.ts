import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { answerAsk, getAsk, getAutopilot, type AskFile } from "@/lib/autopilot/store";
import { runAfterResponse } from "@/lib/autopilot/server";
import { checkStoredFiles } from "@/lib/projects/files";
import { applyMutation, MutationError } from "@/lib/projects/store";
import { requireProject, requireWorkspace } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const body = z.object({
  action: z.enum(["answer", "dismiss"]),
  answer: z.string().max(8000).optional(),
  files: z
    .array(z.object({ storageKey: z.string().min(1).max(600), name: z.string().min(1).max(255) }))
    .max(10)
    .default([]),
});

/**
 * Answers one of the autopilot's questions (with words, a choice, files she
 * uploaded, or "sent" for a client update), or waves it away. Files are added
 * to the project's documents. An answer wakes the autopilot to carry on.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ askId: string }> }) {
  const ws0 = await requireWorkspace();
  if (ws0 instanceof NextResponse) return ws0;
  const ask = await getAsk(ws0.db, ws0.workspaceId, (await ctx.params).askId);
  if (!ask) return NextResponse.json({ error: "That question is no longer here" }, { status: 404 });
  const [project] = await ws0.db.query<{ slug: string }>("SELECT slug FROM projects WHERE id = $1", [ask.projectId]);
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  const ws = await requireProject(project.slug, "ai:use", "ai");
  if (ws instanceof NextResponse) return ws;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Send an answer" }, { status: 400 });
  const input = parsed.data;
  if (input.action === "answer" && !input.answer?.trim() && !input.files.length) return NextResponse.json({ error: "Write an answer or add a file" }, { status: 400 });
  if (ask.status !== "open") return NextResponse.json({ error: "That was already answered" }, { status: 409 });

  const files: AskFile[] = [];
  if (input.action === "answer" && input.files.length) {
    try {
      const documents = input.files.map((f) => ({
        id: crypto.randomUUID(),
        name: f.name,
        sizeBytes: 0,
        phaseKey: ask.phaseKey ?? undefined,
        uploadedAt: new Date().toISOString(),
        clientVisible: false,
        storageKey: f.storageKey,
      }));
      const current = (await ws.db.query<{ current_phase_key: string }>("SELECT current_phase_key FROM projects WHERE id = $1", [ask.projectId]))[0];
      const mutation = await checkStoredFiles(
        { type: "addDocuments", documents: documents.map((d) => ({ ...d, phaseKey: d.phaseKey ?? current.current_phase_key })) },
        ws.workspaceId,
        ask.projectId
      );
      await applyMutation(ws.db, ws.workspaceId, project.slug, mutation);
      files.push(...documents.map((d) => ({ documentId: d.id, name: d.name })));
    } catch (err) {
      if (err instanceof MutationError) return NextResponse.json({ error: err.message }, { status: 400 });
      throw err;
    }
  }
  const saved = await answerAsk(ws.db, ask.id, ws.user.id, {
    status: input.action === "answer" ? "answered" : "dismissed",
    answer: input.answer?.trim(),
    files,
  });
  if (!saved) return NextResponse.json({ error: "That was already answered" }, { status: 409 });

  // A real answer moves the work on; a sent client update or a dismissal needs no run.
  const pilot = await getAutopilot(ws.db, ask.projectId);
  const carryOn = input.action === "answer" && ask.kind !== "message" && pilot.enabled && !pilot.paused;
  if (carryOn) runAfterResponse(ws.db, { workspaceId: ws.workspaceId, projectId: ask.projectId, slug: project.slug, userId: ws.user.id, trigger: "answer" });
  return NextResponse.json({ status: input.action === "answer" ? "answered" : "dismissed", carryOn });
}
