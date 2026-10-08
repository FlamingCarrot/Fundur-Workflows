import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  requireWorkspace,
  requireFeature,
  requirePermission,
} from "@/lib/server/workspace-context";
import { templateInput } from "@/lib/templates/model";
import {
  getTemplate,
  listTemplates,
  saveTemplate,
  removeTemplate,
} from "@/lib/templates/store";
export const dynamic = "force-dynamic";
async function context() {
  const ctx = await requireWorkspace();
  if (ctx instanceof NextResponse) return ctx;
  const denied =
    requireFeature(ctx, "design") || requirePermission(ctx, "project:edit");
  if (denied) return denied;
  if (!["owner", "member"].includes(ctx.workspaceRole))
    return NextResponse.json(
      { error: "Practice templates are available to owners and members." },
      { status: 403 },
    );
  return ctx;
}
export async function GET(req: NextRequest) {
  const ctx = await context();
  if (ctx instanceof NextResponse) return ctx;
  const id = req.nextUrl.searchParams.get("id");
  if (id) {
    if (!z.uuid().safeParse(id).success)
      return NextResponse.json(
        { error: "Template not found" },
        { status: 404 },
      );
    const template = await getTemplate(ctx.db, ctx.workspaceId, id);
    return NextResponse.json(
      template ? { template } : { error: "Template not found" },
      {
        status: template ? 200 : 404,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  }
  return NextResponse.json(
    { templates: await listTemplates(ctx.db, ctx.workspaceId) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
export async function POST(req: NextRequest) {
  const ctx = await context();
  if (ctx instanceof NextResponse) return ctx;
  const text = await req.text();
  if (text.length > 2_000_000)
    return NextResponse.json(
      { error: "This setup is too large." },
      { status: 413 },
    );
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return NextResponse.json(
      { error: "Could not read this template." },
      { status: 400 },
    );
  }
  const parsed = templateInput.safeParse(raw);
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 },
    );
  try {
    return NextResponse.json({
      template: await saveTemplate(
        ctx.db,
        ctx.workspaceId,
        ctx.user.id,
        parsed.data,
      ),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
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
      { error: "Choose a saved template." },
      { status: 400 },
    );
  const removed = await removeTemplate(ctx.db, ctx.workspaceId, parsed.data.id);
  return NextResponse.json(
    removed ? { removed: true } : { error: "Template not found" },
    { status: removed ? 200 : 404 },
  );
}
