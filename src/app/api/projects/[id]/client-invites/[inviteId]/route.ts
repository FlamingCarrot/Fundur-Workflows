import { NextResponse } from "next/server";
import { z } from "zod";
import { requireProject } from "@/lib/server/workspace-context";
import { updateClientInvite } from "@/lib/team/store";
import { clientViewSettingsSchema } from "@/lib/team/client-view";
import { readJson, teamFailure, teamJson } from "@/lib/team/http";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string; inviteId: string }> };
const change = z.object({ settings: clientViewSettingsSchema.optional(), revoke: z.literal(true).optional() }).strict();

/** Changes what the client sees, or ends their access. */
export async function PATCH(req: Request, { params }: Context) {
  const { id, inviteId } = await params;
  const ctx = await requireProject(id, "document:share", "sharing", "client");
  if (ctx instanceof NextResponse) return ctx;
  const input = change.safeParse(await readJson(req));
  if (!input.success || !z.uuid().safeParse(inviteId).success) return teamJson({ error: "Could not read the change" }, 400);
  try {
    return teamJson({ invite: await updateClientInvite(ctx.db, ctx.workspaceId, id, ctx.user.id, inviteId, input.data) });
  } catch (e) {
    return teamFailure(e);
  }
}
