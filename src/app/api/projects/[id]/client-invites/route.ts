import { NextResponse } from "next/server";
import { requireProject } from "@/lib/server/workspace-context";
import { createClientInvite, listClientInvites } from "@/lib/team/store";
import { newClientInviteSchema } from "@/lib/team/client-view";
import { assertFeature } from "@/lib/billing/guard";
import { readJson, teamFailure, teamJson } from "@/lib/team/http";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Context) {
  const { id } = await params;
  const ctx = await requireProject(id, "document:share", "sharing", "client");
  if (ctx instanceof NextResponse) return ctx;
  try {
    return teamJson({ invites: await listClientInvites(ctx.db, ctx.workspaceId, id) });
  } catch (e) {
    return teamFailure(e);
  }
}

/** Invites the client's email address. The link is shown once; only its hash is kept. */
export async function POST(req: Request, { params }: Context) {
  const { id } = await params;
  const ctx = await requireProject(id, "document:share", "sharing", "client");
  if (ctx instanceof NextResponse) return ctx;
  const input = newClientInviteSchema.safeParse(await readJson(req));
  if (!input.success) return teamJson({ error: input.error.issues[0].message }, 400);
  try {
    await assertFeature(ctx, "client_portal", "Client progress pages are on the Paid plan.");
    const { invite, token } = await createClientInvite(ctx.db, ctx.workspaceId, id, ctx.user.id, input.data.email, input.data.settings);
    return teamJson({ invite, url: `${new URL(req.url).origin}/client/${token}` }, 201);
  } catch (e) {
    return teamFailure(e);
  }
}
