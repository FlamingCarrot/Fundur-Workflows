import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createIssue, listMyIssues } from "@/lib/issues/store";
import { MODULE_REGISTRY } from "@/lib/modules/registry";
import { requireWorkspace } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";

/** The signed-in person's own reports that are not closed. */
export async function GET() {
  const ctx = await requireWorkspace();
  if (ctx instanceof NextResponse) return ctx;
  return NextResponse.json({ issues: await listMyIssues(ctx.db, ctx.workspaceId, ctx.user.id) });
}

const newIssue = z.object({
  moduleKey: z.string().refine((k) => k in MODULE_REGISTRY, "Unknown module"),
  note: z.string().trim().min(1).max(5_000),
  path: z.string().max(2_000),
  projectId: z.string().max(255).optional(),
});

/** Files a report; it shows in the Admin's ticket queue straight away. */
export async function POST(req: NextRequest) {
  const ctx = await requireWorkspace();
  if (ctx instanceof NextResponse) return ctx;
  const parsed = newIssue.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const issue = await createIssue(ctx.db, ctx.workspaceId, ctx.user.id, parsed.data);
  return NextResponse.json({ issue }, { status: 201 });
}
