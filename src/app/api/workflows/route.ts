import { NextResponse } from "next/server";
import { z } from "zod";
import {
  requireWorkspace,
  requirePermission,
} from "@/lib/server/workspace-context";
import {
  listDrafts,
  listPublishedWorkflows,
  createDraft,
} from "@/lib/workflow/store";
import { WorkflowDefinitionSchema } from "@/lib/workflow/schema";
import { getWorkflow, listWorkflows } from "@/lib/workflow";
export const dynamic = "force-dynamic";
const json = (data: unknown, status = 200) =>
  NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export async function GET() {
  const ctx = await requireWorkspace();
  if (ctx instanceof NextResponse) return ctx;
  const denied = requirePermission(ctx, "workflow:edit");
  if (denied) return denied;
  return json({
    drafts: await listDrafts(ctx.db, ctx.workspaceId),
    versions: await listPublishedWorkflows(ctx.db, ctx.workspaceId),
  });
}
export async function POST(req: Request) {
  const ctx = await requireWorkspace();
  if (ctx instanceof NextResponse) return ctx;
  const denied = requirePermission(ctx, "workflow:edit");
  if (denied) return denied;
  const raw = await req.text();
  if (raw.length > 100_000)
    return json({ error: "Keep imports under 100 KB." }, 400);
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return json(
      { error: "Choose a workflow or import a valid JSON definition." },
      400,
    );
  }
  const parsed = z
    .object({
      definition: WorkflowDefinitionSchema.optional(),
      sourceId: z.string().max(100).optional(),
    })
    .strict()
    .safeParse(value);
  if (!parsed.success)
    return json({ error: parsed.error.issues[0].message }, 400);
  let source = parsed.data.definition;
  if (!source && parsed.data.sourceId) {
    source = (await listPublishedWorkflows(ctx.db, ctx.workspaceId))
      .filter((w) => w.id === parsed.data.sourceId)
      .at(-1);
  }
  if(parsed.data.sourceId && !source)return json({error:"Published workflow not found"},404);
  source ??= getWorkflow(listWorkflows()[0].id);
  return json(
    { draft: await createDraft(ctx.db, ctx.workspaceId, ctx.user.id, source) },
    201,
  );
}
