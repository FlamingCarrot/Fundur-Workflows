import { NextResponse } from "next/server";
import { requireProject } from "@/lib/server/workspace-context";
import {
  getDesign,
  saveDesign,
  DesignError,
  DesignConflict,
} from "@/lib/design/store";
import { saveDesignSchema } from "@/lib/design/schema";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function GET(_req: Request, { params }: Context) {
  const { id } = await params;
  const ctx = await requireProject(id, "project:view", "design");
  if (ctx instanceof NextResponse) return ctx;
  return NextResponse.json(await getDesign(ctx.db, ctx.workspaceId, id), {
    headers: { "Cache-Control": "private, no-store" },
  });
}
export async function PUT(req: Request, { params }: Context) {
  const { id } = await params;
  const ctx = await requireProject(id, "project:edit", "design");
  if (ctx instanceof NextResponse) return ctx;
  const text = await req.text();
  if (text.length > 2_000_000)
    return NextResponse.json(
      {
        error: "This board is too large. Reduce the number of cards or notes.",
      },
      { status: 413 },
    );
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return NextResponse.json(
      { error: "Could not read the changes" },
      { status: 400 },
    );
  }
  const parsed = saveDesignSchema.safeParse(raw);
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 },
    );
  try {
    return NextResponse.json(
      await saveDesign(
        ctx.db,
        ctx.workspaceId,
        ctx.user.id,
        id,
        parsed.data.data,
        parsed.data.baseRevision,
      ),
    );
  } catch (e) {
    if (e instanceof DesignConflict)
      return NextResponse.json(
        { error: e.message, current: e.current },
        { status: 409 },
      );
    if (e instanceof DesignError)
      return NextResponse.json({ error: e.message }, { status: e.status });
    console.error(
      "Design save failed",
      e instanceof Error ? e.name : "unknown",
    );
    return NextResponse.json(
      { error: "Your changes could not be saved. Please retry." },
      { status: 500 },
    );
  }
}
