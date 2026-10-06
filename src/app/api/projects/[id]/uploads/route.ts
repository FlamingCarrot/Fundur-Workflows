import { NextRequest, NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { projectDbId } from "@/lib/projects/store";
import { requireWorkspace } from "@/lib/server/workspace-context";
import { isInProject, isStorageConfigured, MAX_FILE_BYTES, projectPrefix } from "@/lib/storage/blob";

export const dynamic = "force-dynamic";

async function projectContext(slug: string) {
  const ws = await requireWorkspace();
  if (ws instanceof NextResponse) return ws;
  if (!isStorageConfigured()) {
    return NextResponse.json({ error: "File storage is not set up in this deployment" }, { status: 503 });
  }
  const projectId = await projectDbId(ws.db, ws.workspaceId, slug);
  if (!projectId) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  return { ...ws, projectId };
}

/** The storage folder this project's uploads go into. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const pc = await projectContext((await ctx.params).id);
  if (pc instanceof NextResponse) return pc;
  return NextResponse.json({ prefix: projectPrefix(pc.workspaceId, pc.projectId), maxBytes: MAX_FILE_BYTES });
}

/**
 * Issues a short-lived token for the browser to upload one file straight to
 * storage, only into this project's folder and only up to the size limit.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const pc = await projectContext((await ctx.params).id);
  if (pc instanceof NextResponse) return pc;
  const body = (await req.json().catch(() => null)) as HandleUploadBody | null;
  if (!body) return NextResponse.json({ error: "Bad upload request" }, { status: 400 });
  try {
    const result = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        if (!isInProject(pathname, pc.workspaceId, pc.projectId)) throw new Error("Files can only go into this project");
        return { maximumSizeInBytes: MAX_FILE_BYTES, addRandomSuffix: true, allowOverwrite: false };
      },
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
