import { NextRequest, NextResponse } from "next/server";
import { requireProject } from "@/lib/server/workspace-context";
import { collectProjectArchive } from "@/lib/export/project";
import {
  archiveSummary,
  projectArchiveStream,
  ExportError,
} from "@/lib/export/archive";
import { openFile } from "@/lib/storage/blob";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params,
    ctx = await requireProject(id, "project:export");
  if (ctx instanceof NextResponse) return ctx;
  try {
    const archive = await collectProjectArchive(ctx.db, ctx.workspaceId, id);
    if (req.nextUrl.searchParams.get("summary") === "1")
      return NextResponse.json(archiveSummary(archive), {
        headers: { "Cache-Control": "private, no-store" },
      });
    return new Response(projectArchiveStream(archive, openFile), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${archive.slug.replace(/[^a-zA-Z0-9_-]/g, "_")}-project.zip"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    if (e instanceof ExportError)
      return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
