import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  requireWorkspace,
  requireFeature,
  requirePermission,
} from "@/lib/server/workspace-context";
import { sourcingEntryInput } from "@/lib/sourcing/schema";
import {
  canUseSourcingLibrary,
  listSourcingLibrary,
  saveSourcingEntry,
  removeSourcingEntry,
  SourcingLibraryError,
} from "@/lib/sourcing/store";
export const dynamic = "force-dynamic";
async function context() {
  const ctx = await requireWorkspace();
  if (ctx instanceof NextResponse) return ctx;
  const denied =
    requireFeature(ctx, "design") || requirePermission(ctx, "project:edit");
  if (denied) return denied;
  if (!canUseSourcingLibrary(ctx.workspaceRole))
    return NextResponse.json(
      {
        error:
          "Only practice owners and members can use the shared supplier/template library.",
      },
      { status: 403 },
    );
  return ctx;
}
export async function GET() {
  const ctx = await context();
  if (ctx instanceof NextResponse) return ctx;
  return NextResponse.json(
    { entries: await listSourcingLibrary(ctx.db, ctx.workspaceId) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
export async function POST(req: NextRequest) {
  const ctx = await context();
  if (ctx instanceof NextResponse) return ctx;
  const text = await req.text();
  if (text.length > 64_000)
    return NextResponse.json(
      { error: "That library entry is too large." },
      { status: 413 },
    );
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return NextResponse.json(
      { error: "Could not read the library entry." },
      { status: 400 },
    );
  }
  const parsed = sourcingEntryInput.safeParse(raw);
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 },
    );
  try {
    return NextResponse.json({
      entry: await saveSourcingEntry(
        ctx.db,
        ctx.workspaceId,
        ctx.user.id,
        parsed.data,
      ),
    });
  } catch (e) {
    if (e instanceof SourcingLibraryError)
      return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
export async function DELETE(req: NextRequest) {
  const ctx = await context();
  if (ctx instanceof NextResponse) return ctx;
  const parsed = z
    .object({ id: z.uuid() })
    .strict()
    .safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: "Choose a saved library entry." },
      { status: 400 },
    );
  const removed = await removeSourcingEntry(
    ctx.db,
    ctx.workspaceId,
    parsed.data.id,
  );
  return NextResponse.json(
    removed ? { removed: true } : { error: "Library entry not found." },
    { status: removed ? 200 : 404 },
  );
}
