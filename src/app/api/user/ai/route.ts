import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireWorkspace } from "@/lib/server/workspace-context";
import {
  getUserAiSettings,
  saveUserAiSettings,
  listUserProviderKeys,
  getPlatformByokPolicy,
  readRoleModels,
} from "@/lib/ai/settings";
import { friendlyModelName } from "@/lib/ai/auto-models";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await requireWorkspace();
  if (ctx instanceof NextResponse) return ctx;

  const [settings, keys, policy, platformRoles] = await Promise.all([
    getUserAiSettings(ctx.db, ctx.user.id),
    listUserProviderKeys(ctx.db, ctx.user.id),
    getPlatformByokPolicy(ctx.db),
    readRoleModels(ctx.db),
  ]);

  const topModel = platformRoles.orchestrator;
  const platformStatus = {
    configured: !!topModel,
    orchestratorModel: topModel?.model ?? null,
    orchestratorName: topModel ? friendlyModelName(topModel.model) : null,
    provider: topModel?.provider ?? null,
  };

  return NextResponse.json({
    settings,
    keys,
    byokAllowed: policy.byokAllowed,
    platformStatus,
  });
}

const patchSchema = z.object({
  mode: z.enum(["platform", "byok"]),
  autoSelect: z.boolean().optional(),
});

export async function PATCH(req: NextRequest) {
  const ctx = await requireWorkspace();
  if (ctx instanceof NextResponse) return ctx;

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid settings format" }, { status: 400 });
  }

  const policy = await getPlatformByokPolicy(ctx.db);
  if (parsed.data.mode === "byok" && !policy.byokAllowed) {
    return NextResponse.json(
      { error: "Bring Your Own Keys (BYOK) is currently disabled by the platform administrator" },
      { status: 403 }
    );
  }

  const updated = await saveUserAiSettings(ctx.db, ctx.user.id, parsed.data);
  const keys = await listUserProviderKeys(ctx.db, ctx.user.id);

  return NextResponse.json({
    settings: updated,
    keys,
    byokAllowed: policy.byokAllowed,
  });
}
