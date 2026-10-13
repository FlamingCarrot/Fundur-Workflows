import { NextResponse } from "next/server";
import { requireFeature, requirePermission, requireWorkspace } from "@/lib/server/workspace-context";
import { canUseAssemblies } from "@/lib/plan/assembly-store";

/** Anyone who can open plans reads the library (so plans draw the same); owners and members change it. */
export async function libraryContext(write: boolean) {
  const ctx = await requireWorkspace();
  if (ctx instanceof NextResponse) return ctx;
  const denied = requireFeature(ctx, "floor_plan") || (write ? requirePermission(ctx, "project:edit") : null);
  if (denied) return denied;
  if (write && !canUseAssemblies(ctx.workspaceRole))
    return NextResponse.json({ error: "Only practice owners and members can change the design library." }, { status: 403 });
  return ctx;
}

export const noStore = { "Cache-Control": "private, no-store" };
