import { NextRequest, NextResponse } from "next/server";
import { briefPrompt, briefSchema, MAX_NOTES_CHARS, parseBriefDraft } from "@/lib/ai/brief";
import { extractText, UnreadableFileError } from "@/lib/ai/extract";
import { ProviderError, ProviderKeyError, ProviderRefusalError } from "@/lib/ai/providers";
import { AiNotConfiguredError, runAi } from "@/lib/ai/runs";
import { BRIEF_DRAFT_TASK, getProject, projectDbId } from "@/lib/projects/store";
import { requireWorkspace } from "@/lib/server/workspace-context";
import { getForm, getWorkflow, label, phaseWithForm } from "@/lib/workflow";

export const dynamic = "force-dynamic";
// A long set of notes on a strong model can take a minute or two.
export const maxDuration = 300;

/** Vercel refuses request bodies over 4.5 MB; notes are far smaller. */
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/**
 * Drafts the project's brief from meeting notes (P1-13): uploaded text, Word
 * or PDF files and pasted text. Returns the draft for review; nothing is
 * written to the brief until the designer picks fields. The call is logged
 * with its cost (P1-14), and the project comes back with its new totals.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const ws = await requireWorkspace();
  if (ws instanceof NextResponse) return ws;
  const slug = (await ctx.params).id;
  const project = await getProject(ws.db, ws.workspaceId, slug);
  const projectId = project && (await projectDbId(ws.db, ws.workspaceId, slug));
  if (!project || !projectId) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Send the notes as a form" }, { status: 400 });
  const files = form.getAll("files").filter((f): f is File => typeof f !== "string");
  const pasted = String(form.get("text") ?? "").trim();
  if (files.reduce((n, f) => n + f.size, 0) > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "Those notes are over 4 MB together. Add fewer files at a time." }, { status: 413 });
  }

  const sources: { name: string; text: string }[] = [];
  try {
    for (const f of files) {
      const text = (await extractText(f.name, new Uint8Array(await f.arrayBuffer()))).trim();
      if (text) sources.push({ name: f.name, text });
    }
  } catch (err) {
    if (err instanceof UnreadableFileError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
  if (pasted) sources.push({ name: "Pasted notes", text: pasted });
  if (!sources.length) return NextResponse.json({ error: "There is no text in those notes" }, { status: 400 });
  if (sources.reduce((n, s) => n + s.text.length, 0) > MAX_NOTES_CHARS) {
    return NextResponse.json({ error: "Those notes are too long to draft from at once. Split them up." }, { status: 413 });
  }

  const fields = getForm(project, "brief")?.fields ?? [];
  if (!fields.length) return NextResponse.json({ error: "This workflow has no brief form" }, { status: 400 });
  const action = phaseWithForm(project, "brief")?.ai_actions.find((a) => a.outputType === "structured_brief");
  const { system, prompt } = briefPrompt({
    workflowName: getWorkflow(project).name,
    formLabel: label(project, "brief", "Brief"),
    actionDescription: action?.description,
    fields,
    existing: project.brief,
    sources,
  });

  try {
    const run = await runAi(
      ws.db,
      { workspaceId: ws.workspaceId, projectId, userId: ws.user.id, task: BRIEF_DRAFT_TASK },
      { system, prompt, schema: briefSchema(fields), maxTokens: 16_000 }
    );
    const draft = parseBriefDraft(run.text, fields);
    return NextResponse.json({
      draft,
      costZar: run.costZar,
      model: run.model,
      project: await getProject(ws.db, ws.workspaceId, slug),
    });
  } catch (err) {
    if (err instanceof AiNotConfiguredError) {
      return NextResponse.json(
        { error: "No AI model is set up yet.", code: "not_configured", isAdmin: ws.user.platformRole === "admin" },
        { status: 503 }
      );
    }
    if (err instanceof ProviderKeyError) {
      return NextResponse.json({ error: "The AI key no longer works. The Admin needs to enter it again in Settings." }, { status: 502 });
    }
    if (err instanceof ProviderRefusalError) return NextResponse.json({ error: err.message }, { status: 502 });
    if (err instanceof ProviderError) {
      return NextResponse.json({ error: "The AI provider had a problem. Try again in a moment." }, { status: 502 });
    }
    if (err instanceof Error && /draft/.test(err.message)) return NextResponse.json({ error: err.message }, { status: 502 });
    throw err;
  }
}
