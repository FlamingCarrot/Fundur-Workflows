import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { del, put } from "@vercel/blob";
import { z } from "zod";
import { getDocument } from "@/lib/ai/chat-documents";
import { documentPage } from "@/lib/ai/markdown";
import { applyMutation, getProject, projectDbId } from "@/lib/projects/store";
import { requireProject } from "@/lib/server/workspace-context";
import { isStorageConfigured, projectPrefix } from "@/lib/storage/blob";
import { getWorkflow } from "@/lib/workflow";

export const dynamic = "force-dynamic";

/**
 * Files a chat document with the project's documents, as a Word document
 * (Word, Google Docs and Pages open it), in the phase she picks or the
 * current one.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ docId: string }> }) {
  const slug = req.nextUrl.searchParams.get("project");
  if (!slug) return NextResponse.json({ error: "Open a project to file this document in it" }, { status: 400 });
  const pc = await requireProject(slug, "project:edit", "ai");
  if (pc instanceof NextResponse) return pc;
  if (!isStorageConfigured()) return NextResponse.json({ error: "File storage is not set up, so documents can't be filed yet" }, { status: 503 });
  const { docId } = await ctx.params;
  const body = z.object({ phaseKey: z.string().max(100).optional() }).safeParse(await req.json().catch(() => ({})));
  const project = await getProject(pc.db, pc.workspaceId, slug);
  const projectId = await projectDbId(pc.db, pc.workspaceId, slug);
  if (!project || !projectId || !z.string().uuid().safeParse(docId).success) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const doc = await getDocument(pc.db, pc.workspaceId, projectId, pc.user.id, docId);
  if (!doc) return NextResponse.json({ error: "This document is gone" }, { status: 404 });
  const phaseKey = body.success && body.data.phaseKey && getWorkflow(project).phases.some((p) => p.key === body.data.phaseKey) ? body.data.phaseKey : project.currentPhase;

  const id = randomUUID();
  const bytes = Buffer.from(documentPage(doc.title, doc.content), "utf8");
  const name = `${doc.title.replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 120) || "Document"}.doc`;
  const path = `${projectPrefix(pc.workspaceId, projectId)}chat/${id}.doc`;
  await put(path, bytes, { access: "private", contentType: "application/msword", addRandomSuffix: false });
  try {
    const updated = await applyMutation(pc.db, pc.workspaceId, slug, {
      type: "addDocuments",
      documents: [{ id, name, sizeBytes: bytes.length, phaseKey, uploadedAt: new Date().toISOString(), clientVisible: false, storageKey: path, kind: doc.kind === "research" ? "Research report" : "Document" }],
    });
    return NextResponse.json({ project: updated, documentId: id, name });
  } catch (err) {
    await del(path).catch(() => {});
    throw err;
  }
}
