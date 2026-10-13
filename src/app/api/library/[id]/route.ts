import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { entryUpdate } from "@/lib/blueprints/schema";
import { getEntry, LibraryConflictError, LibraryError, removeEntry, updateEntry } from "@/lib/blueprints/store";
import { libraryContext, noStore } from "../context";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const ctx = await libraryContext(false);
  if (ctx instanceof NextResponse) return ctx;
  const entry = await getEntry(ctx.db, ctx.workspaceId, (await params).id);
  return entry ? NextResponse.json(entry, { headers: noStore }) : NextResponse.json({ error: "Not in the library." }, { status: 404 });
}

export async function PUT(req: NextRequest, { params }: Params) {
  const ctx = await libraryContext(true);
  if (ctx instanceof NextResponse) return ctx;
  const parsed = entryUpdate.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: z.prettifyError(parsed.error) }, { status: 400 });
  try {
    return NextResponse.json(await updateEntry(ctx.db, ctx.workspaceId, ctx.user.id, (await params).id, parsed.data.baseRevision, parsed.data.body), { headers: noStore });
  } catch (e) {
    if (e instanceof LibraryConflictError) return NextResponse.json({ error: e.message, current: e.current }, { status: 409 });
    if (e instanceof LibraryError) return NextResponse.json({ error: e.message }, { status: 400 });
    if (e instanceof z.ZodError) return NextResponse.json({ error: z.prettifyError(e) }, { status: 400 });
    throw e;
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const ctx = await libraryContext(true);
  if (ctx instanceof NextResponse) return ctx;
  const removed = await removeEntry(ctx.db, ctx.workspaceId, (await params).id);
  return removed ? NextResponse.json({ removed: true }) : NextResponse.json({ error: "Not in the library." }, { status: 404 });
}
