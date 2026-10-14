import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDocument, listVersions, restoreVersion, saveDocument, MAX_DOCUMENT_CHARS } from "@/lib/ai/chat-documents";
import { assistantScope } from "../../scope";

export const dynamic = "force-dynamic";

/** A chat document (?project= for one of a project's) with its versions, for the canvas. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ docId: string }> }) {
  const s = await assistantScope(req.nextUrl.searchParams.get("project"));
  if (s instanceof NextResponse) return s;
  const { docId } = await ctx.params;
  if (!z.string().uuid().safeParse(docId).success) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const document = await getDocument(s.db, s.workspaceId, s.projectId, s.user.id, docId);
  if (!document) return NextResponse.json({ error: "This document is gone" }, { status: 404 });
  return NextResponse.json({ document, versions: await listVersions(s.db, s.workspaceId, s.projectId, s.user.id, docId) });
}

const saveInput = z.union([
  z.object({ title: z.string().max(200).optional(), content: z.string().max(MAX_DOCUMENT_CHARS).optional(), expectedVersion: z.number().int().positive() }),
  z.object({ restore: z.number().int().positive() }),
]);

/** Saves her edits (refused when the assistant saved in between), or puts an earlier version back. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ docId: string }> }) {
  const s = await assistantScope(req.nextUrl.searchParams.get("project"));
  if (s instanceof NextResponse) return s;
  const { docId } = await ctx.params;
  const parsed = saveInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !z.string().uuid().safeParse(docId).success) return NextResponse.json({ error: "That could not be saved" }, { status: 400 });
  const saved =
    "restore" in parsed.data
      ? await restoreVersion(s.db, s.workspaceId, s.projectId, s.user.id, docId, parsed.data.restore)
      : await saveDocument(s.db, s.workspaceId, s.projectId, s.user.id, docId, parsed.data);
  if (saved === "conflict") {
    return NextResponse.json({ error: "Fundur changed this document while you were editing.", document: await getDocument(s.db, s.workspaceId, s.projectId, s.user.id, docId) }, { status: 409 });
  }
  if (!saved) return NextResponse.json({ error: "This document is gone" }, { status: 404 });
  return NextResponse.json({ document: saved });
}
