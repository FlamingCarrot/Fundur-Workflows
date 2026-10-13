import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { entryInput } from "@/lib/blueprints/schema";
import { createEntry, LibraryError, listLibrary } from "@/lib/blueprints/store";
import { libraryContext, noStore } from "./context";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await libraryContext(false);
  if (ctx instanceof NextResponse) return ctx;
  return NextResponse.json(await listLibrary(ctx.db, ctx.workspaceId), { headers: noStore });
}

export async function POST(req: NextRequest) {
  const ctx = await libraryContext(true);
  if (ctx instanceof NextResponse) return ctx;
  const parsed = entryInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: z.prettifyError(parsed.error) }, { status: 400 });
  try {
    const created = await createEntry(ctx.db, ctx.workspaceId, ctx.user.id, parsed.data.kind, parsed.data.body);
    return NextResponse.json(created, { status: 201, headers: noStore });
  } catch (e) {
    if (e instanceof LibraryError) return NextResponse.json({ error: e.message }, { status: 409 });
    throw e;
  }
}
