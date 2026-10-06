import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { PROVIDER_IDS, isProviderId } from "@/lib/ai/providers";
import { addEnabledModel, readAiSettings, readDefaultModel, removeEnabledModel } from "@/lib/ai/settings";
import { requireAdmin } from "@/lib/server/workspace-context";
import { findModel } from "../find-model";

export const dynamic = "force-dynamic";

const modelInput = z.object({
  provider: z.enum(PROVIDER_IDS),
  model: z.string().trim().min(1).max(255),
});

/** Adds a model the saved key can use to the shortlist. */
export async function PUT(req: NextRequest) {
  const ctx = await requireAdmin();
  if (ctx instanceof NextResponse) return ctx;
  const parsed = modelInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const { provider, model } = parsed.data;
  const option = await findModel(ctx.db, provider, model);
  if (option instanceof NextResponse) return option;
  await addEnabledModel(ctx.db, provider, option, ctx.user.id);
  return NextResponse.json(await readAiSettings(ctx.db));
}

/** Takes a model off the shortlist. The default model stays until another is chosen. */
export async function DELETE(req: NextRequest) {
  const ctx = await requireAdmin();
  if (ctx instanceof NextResponse) return ctx;
  const provider = req.nextUrl.searchParams.get("provider");
  const model = req.nextUrl.searchParams.get("model");
  if (!isProviderId(provider) || !model) return NextResponse.json({ error: "Say which model to remove" }, { status: 400 });
  const current = await readDefaultModel(ctx.db);
  if (current?.provider === provider && current.model === model) {
    return NextResponse.json({ error: "This is the default model. Choose another default first." }, { status: 400 });
  }
  await removeEnabledModel(ctx.db, provider, model);
  return NextResponse.json(await readAiSettings(ctx.db));
}
