import { NextResponse } from "next/server";
import { z } from "zod";
import {
  requireWorkspace,
  requirePermission,
} from "@/lib/server/workspace-context";
import { WorkflowDefinitionSchema } from "@/lib/workflow/schema";
import {
  getDraft,
  saveDraft,
  publishDraft,
  publishedWorkflow,
  WorkflowEditError,
} from "@/lib/workflow/store";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ctx = await requireWorkspace();
  if (ctx instanceof NextResponse) return ctx;
  const denied = requirePermission(ctx, "workflow:edit");
  if (denied) return denied;
  const draft = await getDraft(ctx.db, ctx.workspaceId, id);
  return draft ? json({ draft }) : json({ error: "Workflow not found" }, 404);
}
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ctx = await requireWorkspace();
  if (ctx instanceof NextResponse) return ctx;
  const raw = await req.text();
  if (raw.length > 105_000)
    return json({ error: "Keep the workflow under 100 KB." }, 400);
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return json({ error: "The workflow could not be read." }, 400);
  }
  const parsed = z
    .discriminatedUnion("action", [
      z.object({
        action: z.literal("save"),
        revision: z.number().int().positive(),
        definition: WorkflowDefinitionSchema,
      }),
      z.object({
        action: z.literal("publish"),
        revision: z.number().int().positive(),
      }),
      z.object({
        action: z.literal("restore"),
        revision: z.number().int().positive(),
        version: z.number().int().positive(),
      }),
    ])
    .safeParse(value);
  if (!parsed.success)
    return json({ error: parsed.error.issues[0].message }, 400);
  const input = parsed.data,
    denied = requirePermission(
      ctx,
      input.action === "publish" ? "workflow:publish" : "workflow:edit",
    );
  if (denied) return denied;
  try {
    if (input.action === "publish")
      return json(
        await publishDraft(
          ctx.db,
          ctx.workspaceId,
          ctx.user.id,
          id,
          input.revision,
        ),
      );
    if (input.action === "restore") {
      const source = await publishedWorkflow(
        ctx.db,
        ctx.workspaceId,
        id,
        input.version,
      );
      if (!source) return json({ error: "Published version not found" }, 404);
      return json({
        draft: await saveDraft(
          ctx.db,
          ctx.workspaceId,
          ctx.user.id,
          id,
          input.revision,
          source,
        ),
      });
    }
    return json({
      draft: await saveDraft(
        ctx.db,
        ctx.workspaceId,
        ctx.user.id,
        id,
        input.revision,
        input.definition,
      ),
    });
  } catch (e) {
    if (e instanceof WorkflowEditError)
      return json({ error: e.message }, e.status);
    throw e;
  }
}
