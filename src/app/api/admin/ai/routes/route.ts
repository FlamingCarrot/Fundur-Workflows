import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import "@/lib/ai/tools";
import { listTaskTypes, MAX_RETRIES_LIMIT, readTaskRoutes, saveTaskRoute } from "@/lib/ai/routing";
import { requireAdmin } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";

async function body(db: Parameters<typeof readTaskRoutes>[0]) {
  return { taskTypes: listTaskTypes(), routes: await readTaskRoutes(db) };
}

/** Every kind of AI work, the tier it runs on, and its review retry cap (P4-13, P4-14). */
export async function GET() {
  const ctx = await requireAdmin();
  if (ctx instanceof NextResponse) return ctx;
  return NextResponse.json(await body(ctx.db));
}

const routeInput = z.object({
  taskType: z.string().min(1).max(100),
  tier: z.enum(["top", "worker"]),
  maxRetries: z.number().int().min(0).max(MAX_RETRIES_LIMIT),
});

export async function PUT(req: NextRequest) {
  const ctx = await requireAdmin();
  if (ctx instanceof NextResponse) return ctx;
  const parsed = routeInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  try {
    await saveTaskRoute(ctx.db, parsed.data.taskType, parsed.data.tier, parsed.data.maxRetries, ctx.user.id);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
  return NextResponse.json(await body(ctx.db));
}
