import { NextRequest, NextResponse } from "next/server";
import { ruleSetInput } from "@/lib/layout/rules";
import { createRuleSet, listRuleSets } from "@/lib/layout/store";
import { requireWorkspace } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";

/** The workspace's layout rule sets. */
export async function GET() {
  const ctx = await requireWorkspace();
  if (ctx instanceof NextResponse) return ctx;
  return NextResponse.json({ ruleSets: await listRuleSets(ctx.db, ctx.workspaceId, ctx.user.id) });
}

/** A new rule set. */
export async function POST(req: NextRequest) {
  const ctx = await requireWorkspace();
  if (ctx instanceof NextResponse) return ctx;
  const parsed = ruleSetInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Those rules are not valid" }, { status: 400 });
  const ruleSet = await createRuleSet(ctx.db, ctx.workspaceId, ctx.user.id, parsed.data);
  return NextResponse.json({ ruleSet }, { status: 201 });
}
