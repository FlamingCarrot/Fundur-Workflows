import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import {
  requireWorkspace,
  WORKSPACE_COOKIE,
} from "@/lib/server/workspace-context";
import { memberships, audit } from "@/lib/workspaces/store";
export const dynamic = "force-dynamic";
const input = z.union([
  z.object({ workspaceId: z.uuid() }).strict(),
  z
    .object({
      name: z.string().trim().min(1).max(255),
      branding: z
        .object({
          name: z.string().trim().max(255),
          logoUrl: z.union([
            z.literal(""),
            z
              .url()
              .refine(
                (v) => new URL(v).protocol === "https:",
                "Use an HTTPS image URL",
              ),
          ]),
        })
        .strict(),
    })
    .strict(),
]);
export async function PATCH(req: Request) {
  const ctx = await requireWorkspace();
  if (ctx instanceof NextResponse) return ctx;
  const parsed = input.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 },
    );
  const data = parsed.data;
  if ("workspaceId" in data) {
    if (
      !(await memberships(ctx.db, ctx.user.id)).some(
        (w) => w.id === data.workspaceId,
      )
    )
      return NextResponse.json(
        { error: "Workspace not found" },
        { status: 404 },
      );
    (await cookies()).set(WORKSPACE_COOKIE, data.workspaceId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
    return NextResponse.json({ ok: true });
  }
  if (ctx.workspaceRole !== "owner")
    return NextResponse.json(
      { error: "Only the workspace owner can change these details" },
      { status: 403 },
    );
  await ctx.db.query(
    "UPDATE workspaces SET name=$2,settings=settings||jsonb_build_object('branding',$3::jsonb),updated_at=NOW() WHERE id=$1",
    [ctx.workspaceId, data.name, JSON.stringify(data.branding)],
  );
  await audit(
    ctx.db,
    ctx.workspaceId,
    ctx.user.id,
    "workspace.updated",
    ctx.workspaceId,
    { name: data.name, branding: data.branding },
  );
  return NextResponse.json({ ok: true });
}
export async function GET() {
  const ctx = await requireWorkspace();
  if (ctx instanceof NextResponse) return ctx;
  const [workspace] = await ctx.db.query(
    "SELECT id,name,settings FROM workspaces WHERE id=$1",
    [ctx.workspaceId],
  );
  return NextResponse.json({ workspace });
}
