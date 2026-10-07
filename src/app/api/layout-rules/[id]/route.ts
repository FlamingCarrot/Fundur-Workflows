import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ruleSetInput } from "@/lib/layout/rules";
import { RuleSetConflictError, RuleSetNotFoundError, deleteRuleSet, updateRuleSet } from "@/lib/layout/store";
import { requireWorkspace, requireFeature, requirePermission } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const updateInput = ruleSetInput.extend({ baseRevision: z.number().int().min(1) });

/** Saves a rule set; 409 with the stored one when it changed elsewhere since it was opened. */
export async function PUT(req: NextRequest, { params }: Params) {
  const ctx = await requireWorkspace();
  if (ctx instanceof NextResponse) return ctx;
  const denied = requireFeature(ctx, "layout") || requirePermission(ctx, "project:edit");
  if (denied) return denied;
  const parsed = updateInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Those rules are not valid" }, { status: 400 });
  const id = (await params).id;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Those rules no longer exist" }, { status: 404 });
  try {
    const ruleSet = await updateRuleSet(ctx.db, ctx.workspaceId, ctx.user.id, id, parsed.data);
    return NextResponse.json({ ruleSet });
  } catch (err) {
    if (err instanceof RuleSetConflictError) return NextResponse.json({ error: err.message, current: err.current }, { status: 409 });
    if (err instanceof RuleSetNotFoundError) return NextResponse.json({ error: err.message }, { status: 404 });
    throw err;
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const ctx = await requireWorkspace();
  if (ctx instanceof NextResponse) return ctx;
  const denied = requireFeature(ctx, "layout") || requirePermission(ctx, "project:edit");
  if (denied) return denied;
  const id = (await params).id;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Those rules no longer exist" }, { status: 404 });
  try {
    await deleteRuleSet(ctx.db, ctx.workspaceId, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof RuleSetConflictError) return NextResponse.json({ error: "The last set of rules stays, so there is always one to lay out with" }, { status: 409 });
    if (err instanceof RuleSetNotFoundError) return NextResponse.json({ error: err.message }, { status: 404 });
    throw err;
  }
}
