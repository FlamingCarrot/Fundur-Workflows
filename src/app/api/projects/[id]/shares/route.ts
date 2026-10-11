import { NextResponse } from "next/server";
import { requireProject, requireFeature } from "@/lib/server/workspace-context";
import { createShareInput, visibilityInput } from "@/lib/sharing/schema";
import { createShare, listShares, setVisibility } from "@/lib/sharing/store";
import { shareJson, shareFailure } from "@/lib/sharing/http";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
export async function GET(_req: Request, { params }: Context) {
  const { id } = await params;
  const ctx = await requireProject(id, "document:share", "sharing");
  if (ctx instanceof NextResponse) return ctx;
  try {
    const shares = await listShares(ctx.db, ctx.workspaceId, id);
    if (!ctx.features.design)
      shares.targets = shares.targets.filter(
        (t) => t.type !== "board" && t.type !== "schedule",
      );
    return shareJson(shares);
  } catch (e) {
    return shareFailure(e);
  }
}
export async function POST(req: Request, { params }: Context) {
  const { id } = await params;
  const ctx = await requireProject(id, "document:share", "sharing");
  if (ctx instanceof NextResponse) return ctx;
  const input = createShareInput.safeParse(await req.json().catch(() => null));
  if (!input.success)
    return shareJson({ error: input.error.issues[0].message }, 400);
  if (["board", "schedule"].includes(input.data.targetType)) {
    const disabled = requireFeature(ctx, "design");
    if (disabled) return disabled;
  }
  try {
    const result = await createShare(
      ctx.db,
      ctx.workspaceId,
      id,
      ctx.user.id,
      input.data,
    );
    return shareJson({ ...result, path: `/share/${result.token}` }, 201);
  } catch (e) {
    return shareFailure(e);
  }
}
export async function PATCH(req: Request, { params }: Context) {
  const { id } = await params;
  const ctx = await requireProject(id, "document:share", "sharing");
  if (ctx instanceof NextResponse) return ctx;
  const input = visibilityInput.safeParse(await req.json().catch(() => null));
  if (!input.success)
    return shareJson({ error: input.error.issues[0].message }, 400);
  if (["board", "schedule"].includes(input.data.targetType)) {
    const disabled = requireFeature(ctx, "design");
    if (disabled) return disabled;
  }
  try {
    return shareJson(
      await setVisibility(ctx.db, ctx.workspaceId, id, input.data),
    );
  } catch (e) {
    return shareFailure(e);
  }
}
