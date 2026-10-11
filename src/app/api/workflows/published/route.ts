import { NextResponse } from "next/server";
import {
  requireWorkspace,
  requirePermission,
} from "@/lib/server/workspace-context";
import { listPublishedWorkflows } from "@/lib/workflow/store";
export const dynamic = "force-dynamic";
export async function GET() {
  const ctx = await requireWorkspace();
  if (ctx instanceof NextResponse) return ctx;
  const denied = requirePermission(ctx, "project:create");
  if (denied) return denied;
  return NextResponse.json(
    { versions: await listPublishedWorkflows(ctx.db, ctx.workspaceId) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
