import { NextRequest, NextResponse } from "next/server";
import {
  requireWorkspace,
  requireFeature,
  requirePermission,
} from "@/lib/server/workspace-context";
import { assemblyInput } from "@/lib/plan/groups";
import {
  canUseAssemblies,
  createAssembly,
  listAssemblies,
  removeAssembly,
} from "@/lib/plan/assembly-store";
import { z } from "zod";

export const dynamic = "force-dynamic";
async function context() {
  const ctx = await requireWorkspace();
  if (ctx instanceof NextResponse) return ctx;
  const denied =
    requireFeature(ctx, "floor_plan") || requirePermission(ctx, "project:edit");
  if (denied) return denied;
  if (!canUseAssemblies(ctx.workspaceRole))
    return NextResponse.json(
      { error: "Only practice owners and members can use the shared library." },
      { status: 403 },
    );
  return ctx;
}
export async function GET() {
  const ctx = await context();
  if (ctx instanceof NextResponse) return ctx;
  return NextResponse.json({
    assemblies: await listAssemblies(ctx.db, ctx.workspaceId),
  });
}
export async function POST(req: NextRequest) {
  const ctx = await context();
  if (ctx instanceof NextResponse) return ctx;
  const parsed = assemblyInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: "That arrangement is invalid." },
      { status: 400 },
    );
  try {
    return NextResponse.json(
      {
        assembly: await createAssembly(
          ctx.db,
          ctx.workspaceId,
          ctx.user.id,
          parsed.data,
        ),
      },
      { status: 201 },
    );
  } catch (e) {
    if (
      e instanceof Error &&
      e.message.startsWith("The practice library is full")
    )
      return NextResponse.json({ error: e.message }, { status: 409 });
    throw e;
  }
}
export async function DELETE(req: NextRequest) {
  const ctx = await context();
  if (ctx instanceof NextResponse) return ctx;
  const parsed = z
    .object({ id: z.uuid() })
    .safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: "Choose a saved arrangement." },
      { status: 400 },
    );
  const removed = await removeAssembly(ctx.db, ctx.workspaceId, parsed.data.id);
  return NextResponse.json(
    removed ? { removed: true } : { error: "Arrangement not found." },
    { status: removed ? 200 : 404 },
  );
}
