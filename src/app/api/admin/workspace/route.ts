import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/server/workspace-context";
import {
  invite,
  workspaceSummary,
  audit,
  FEATURE_KEYS,
} from "@/lib/workspaces/store";
export const dynamic = "force-dynamic";
const input = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("invite"),
      email: z.email(),
      role: z.enum(["owner", "member", "collaborator"]),
      projectIds: z.array(z.uuid()).max(100).default([]),
    })
    .strict(),
  z.object({ action: z.literal("revokeInvite"), id: z.uuid() }).strict(),
  z
    .object({
      action: z.literal("feature"),
      userId: z.string().min(1).max(255),
      key: z.enum(FEATURE_KEYS),
      enabled: z.boolean(),
    })
    .strict(),
]);
export async function GET() {
  const ctx = await requireAdmin();
  if (ctx instanceof NextResponse) return ctx;
  return NextResponse.json(await workspaceSummary(ctx.db, ctx.workspaceId));
}
export async function POST(req: Request) {
  const ctx = await requireAdmin();
  if (ctx instanceof NextResponse) return ctx;
  const parsed = input.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 },
    );
  const data = parsed.data;
  try {
    if (data.action === "invite") {
      const created = await invite(
        ctx.db,
        ctx.workspaceId,
        ctx.user.id,
        data.email,
        data.role,
        data.projectIds,
      );
      return NextResponse.json(
        { path: `/invite/${created.token}` },
        { status: 201 },
      );
    }
    if (data.action === "revokeInvite") {
      await ctx.db.query(
        "UPDATE workspace_invitations SET revoked_at=COALESCE(revoked_at,NOW()) WHERE workspace_id=$1 AND id=$2 AND accepted_at IS NULL",
        [ctx.workspaceId, data.id],
      );
      await audit(
        ctx.db,
        ctx.workspaceId,
        ctx.user.id,
        "invitation.revoked",
        data.id,
      );
    } else {
      const [member] = await ctx.db.query(
        "SELECT id FROM memberships WHERE workspace_id=$1 AND user_id=$2",
        [ctx.workspaceId, data.userId],
      );
      if (!member)
        return NextResponse.json(
          { error: "Member not found" },
          { status: 404 },
        );
      await ctx.db.query(
        "INSERT INTO workspace_user_features(workspace_id,user_id,feature_key,enabled) VALUES($1,$2,$3,$4) ON CONFLICT(workspace_id,user_id,feature_key) DO UPDATE SET enabled=EXCLUDED.enabled",
        [ctx.workspaceId, data.userId, data.key, data.enabled],
      );
      await audit(
        ctx.db,
        ctx.workspaceId,
        ctx.user.id,
        "feature.updated",
        data.userId,
        { key: data.key, enabled: data.enabled },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not update workspace" },
      { status: 400 },
    );
  }
}
