import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/server/workspace-context";
import {
  builderSettings,
  saveBuilderSettings,
  capabilityBacklog,
  builderEditMetrics,
} from "@/lib/workflow/builder-store";
export const dynamic = "force-dynamic";
const json = (data: unknown, status = 200) =>
  NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export async function GET() {
  const ctx = await requireAdmin();
  if (ctx instanceof NextResponse) return ctx;
  return json({
    settings: await builderSettings(ctx.db, ctx.workspaceId),
    backlog: await capabilityBacklog(ctx.db),
    metrics: await builderEditMetrics(ctx.db),
  });
}
export async function PUT(req: Request) {
  const ctx = await requireAdmin();
  if (ctx instanceof NextResponse) return ctx;
  const input = z
    .discriminatedUnion("action", [
      z
        .object({
          action: z.literal("settings"),
          enabled: z.boolean(),
          audience: z.enum(["admin", "owners"]),
          monthlyCapZar: z.number().min(0).max(10000),
        })
        .strict(),
      z
        .object({
          action: z.literal("capability"),
          id: z.uuid(),
          status: z.enum(["open", "planned", "delivered", "dismissed"]),
        })
        .strict(),
    ])
    .safeParse(await req.json().catch(() => null));
  if (!input.success)
    return json({ error: input.error.issues[0].message }, 400);
  if (input.data.action === "settings")
    return json({
      settings: await saveBuilderSettings(
        ctx.db,
        ctx.workspaceId,
        ctx.user.id,
        input.data,
      ),
    });
  const rows = await ctx.db.query(
    "UPDATE workflow_capability_requests SET status=$2 WHERE id=$1 RETURNING id",
    [input.data.id, input.data.status],
  );
  return rows.length
    ? json({ ok: true })
    : json({ error: "Request not found" }, 404);
}
