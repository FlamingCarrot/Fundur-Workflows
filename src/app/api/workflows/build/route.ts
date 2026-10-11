import { NextResponse } from "next/server";
import { z } from "zod";
import {
  requireWorkspace,
  requirePermission,
  requireFeature,
} from "@/lib/server/workspace-context";
import { BuildInputSchema, builderModules } from "@/lib/workflow/builder-model";
import {
  builderSettings,
  listBuilds,
  BuilderError,
} from "@/lib/workflow/builder-store";
import { runWorkflowBuild } from "@/lib/workflow/builder";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
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
    settings: await builderSettings(ctx.db, ctx.workspaceId),
    builds: await listBuilds(ctx.db, ctx.workspaceId),
    modules: builderModules(ctx.features),
  });
}
export async function POST(req: Request) {
  const ctx = await requireWorkspace();
  if (ctx instanceof NextResponse) return ctx;
  const denied =
    requirePermission(ctx, "workflow:edit") ?? requireFeature(ctx, "ai");
  if (denied) return denied;
  const raw = await req.text();
  if (raw.length > 70000)
    return json(
      { error: "Keep this description and procedure under 70 KB." },
      400,
    );
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return json({ error: "The request could not be read." }, 400);
  }
  const parsed = z
    .object({
      id: z.uuid(),
      mode: z.enum(["interview", "generate"]),
      input: BuildInputSchema,
    })
    .strict()
    .safeParse(value);
  if (!parsed.success)
    return json({ error: parsed.error.issues[0].message }, 400);
  try {
    return json({
      build: await runWorkflowBuild(
        {
          db: ctx.db,
          workspaceId: ctx.workspaceId,
          userId: ctx.user.id,
          isAdmin: ctx.user.platformRole === "admin",
          features: ctx.features,
        },
        parsed.data.id,
        parsed.data.mode,
        parsed.data.input,
      ),
    });
  } catch (e) {
    if (e instanceof BuilderError) return json({ error: e.message }, e.status);
    throw e;
  }
}
