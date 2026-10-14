import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireWorkspace } from "@/lib/server/workspace-context";
import {
  saveUserProviderKey,
  deleteUserProviderKey,
  listUserProviderKeys,
  getPlatformByokPolicy,
} from "@/lib/ai/settings";
import {
  PROVIDER_IDS,
  listModels,
  ProviderError,
  ProviderKeyError,
  isProviderId,
} from "@/lib/ai/providers";

export const dynamic = "force-dynamic";

const keyInput = z.object({
  provider: z.enum(PROVIDER_IDS),
  key: z.string().trim().min(8).max(500),
});

/**
 * Validates and saves a private BYOK key for the user.
 */
export async function PUT(req: NextRequest) {
  const ctx = await requireWorkspace();
  if (ctx instanceof NextResponse) return ctx;

  const policy = await getPlatformByokPolicy(ctx.db);
  if (!policy.byokAllowed) {
    return NextResponse.json(
      { error: "Bring Your Own Keys (BYOK) is disabled on this platform" },
      { status: 403 }
    );
  }

  const parsed = keyInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Please paste the entire API key" }, { status: 400 });
  }

  const { provider, key } = parsed.data;
  try {
    // Validate key with provider
    await listModels(provider, key);
    await saveUserProviderKey(ctx.db, ctx.user.id, provider, key);
    const keys = await listUserProviderKeys(ctx.db, ctx.user.id);
    return NextResponse.json({ ok: true, keys });
  } catch (err) {
    if (err instanceof ProviderKeyError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof ProviderError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    return NextResponse.json(
      { error: (err as Error).message || "Failed to verify key with provider" },
      { status: 400 }
    );
  }
}

/**
 * Removes a user's private BYOK key.
 */
export async function DELETE(req: NextRequest) {
  const ctx = await requireWorkspace();
  if (ctx instanceof NextResponse) return ctx;

  const provider = req.nextUrl.searchParams.get("provider");
  if (!isProviderId(provider)) {
    return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
  }

  await deleteUserProviderKey(ctx.db, ctx.user.id, provider);
  const keys = await listUserProviderKeys(ctx.db, ctx.user.id);
  return NextResponse.json({ ok: true, keys });
}
