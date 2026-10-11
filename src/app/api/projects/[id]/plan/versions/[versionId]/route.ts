import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPlanVersion } from "@/lib/plan/store";
import { requireProject } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";

/** A named version's geometry, for comparing it with the plan as it is now. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; versionId: string }> }) {
  const ctx = await requireProject((await params).id, "project:view", "floor_plan");
  if (ctx instanceof NextResponse) return ctx;
  const { id, versionId } = await params;
  if (!z.uuid().safeParse(versionId).success) return NextResponse.json({ error: "Version not found" }, { status: 404 });
  const version = await getPlanVersion(ctx.db, ctx.workspaceId, id, versionId);
  if (!version) return NextResponse.json({ error: "Version not found" }, { status: 404 });
  return NextResponse.json({ version });
}
