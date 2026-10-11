import { NextResponse } from "next/server";
import {
  requireWorkspace,
  requirePermission,
} from "@/lib/server/workspace-context";
import { searchSavedWork } from "@/lib/studio/server-search";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const ctx = await requireWorkspace();
  if (ctx instanceof NextResponse) return ctx;
  const denied = requirePermission(ctx, "project:view");
  if (denied) return denied;
  const q = new URL(req.url).searchParams.get("q") ?? "";
  if (q.length > 120)
    return NextResponse.json(
      { error: "Keep searches under 120 characters." },
      { status: 400 },
    );
  return NextResponse.json(
    {
      groups: await searchSavedWork(
        ctx.db,
        {
          workspaceId: ctx.workspaceId,
          userId: ctx.user.id,
          workspaceRole: ctx.workspaceRole,
        },
        q,
      ),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
