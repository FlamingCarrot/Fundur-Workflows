import { NextResponse } from "next/server";
import { z } from "zod";
import {
  requireWorkspace,
  requirePermission,
} from "@/lib/server/workspace-context";
import { acceptBuild, BuilderError } from "@/lib/workflow/builder-store";
export const dynamic = "force-dynamic";
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireWorkspace();
  if (ctx instanceof NextResponse) return ctx;
  const denied = requirePermission(ctx, "workflow:edit");
  if (denied) return denied;
  const { id } = await params;
  if (!z.uuid().safeParse(id).success)
    return NextResponse.json({ error: "Build not found" }, { status: 404 });
  try {
    return NextResponse.json(
      { draft: await acceptBuild(ctx.db, ctx.workspaceId, ctx.user.id, id) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    if (e instanceof BuilderError)
      return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
