import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireAdmin } from "@/lib/server/workspace-context";
import { invite, audit } from "@/lib/workspaces/store";
export const dynamic = "force-dynamic";
const input = z
  .object({ name: z.string().trim().min(1).max(255), ownerEmail: z.email() })
  .strict();
export async function POST(req: Request) {
  const ctx = await requireAdmin();
  if (ctx instanceof NextResponse) return ctx;
  const parsed = input.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 },
    );
  const { name, ownerEmail } = parsed.data;
  const [workspace] = await ctx.db.query<{ id: string }>(
    `WITH w AS(INSERT INTO workspaces(name,slug) VALUES($1,$2) RETURNING id),m AS(INSERT INTO memberships(workspace_id,user_id,role) SELECT id,$3,'owner' FROM w) SELECT id FROM w`,
    [name, `studio-${randomUUID()}`, ctx.user.id],
  );
  const created = await invite(
    ctx.db,
    workspace.id,
    ctx.user.id,
    ownerEmail,
    "owner",
  );
  await audit(
    ctx.db,
    workspace.id,
    ctx.user.id,
    "workspace.created",
    workspace.id,
    { name },
  );
  return NextResponse.json(
    { workspaceId: workspace.id, path: `/invite/${created.token}` },
    { status: 201 },
  );
}
