import { NextRequest, NextResponse } from "next/server";
import { documentFile } from "@/lib/projects/store";
import { requireWorkspace } from "@/lib/server/workspace-context";
import { openFile } from "@/lib/storage/blob";

export const dynamic = "force-dynamic";

/**
 * Downloads a document's file, or one of its versions with ?version=N. Files
 * are private in storage, so every download comes through here and is checked
 * against the signed-in person's workspace.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string; docId: string }> }) {
  const ws = await requireWorkspace();
  if (ws instanceof NextResponse) return ws;
  const { id, docId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(docId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const v = req.nextUrl.searchParams.get("version");
  const version = v && /^\d+$/.test(v) ? Number(v) : undefined;

  const file = await documentFile(ws.db, ws.workspaceId, id, docId, version);
  if (!file) return NextResponse.json({ error: "This file is not stored" }, { status: 404 });
  const opened = await openFile(file.pathname);
  if (!opened) return NextResponse.json({ error: "The file is missing from storage" }, { status: 404 });

  const ascii = file.name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return new Response(opened.stream, {
    headers: {
      "Content-Type": opened.contentType,
      ...(opened.size ? { "Content-Length": String(opened.size) } : {}),
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
