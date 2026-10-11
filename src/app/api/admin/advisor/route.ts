import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  generateAdvice,
  latestRun,
  listResearch,
  listSuggestions,
} from "@/lib/analytics/advisor";
import { AiBudgetError } from "@/lib/ai/budget";
import {
  ProviderError,
  ProviderKeyError,
  ProviderRefusalError,
} from "@/lib/ai/providers";
import { AiNotConfiguredError } from "@/lib/ai/runs";
import { requireAdmin, requireFeature } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** The advisor's latest reading, the list to work from, and the research it reads. */
export async function GET() {
  const ctx = await requireAdmin();
  if (ctx instanceof NextResponse) return ctx;
  const [run, suggestions, research] = await Promise.all([
    latestRun(ctx.db),
    listSuggestions(ctx.db),
    listResearch(ctx.db),
  ]);
  return NextResponse.json({ run, ...suggestions, research });
}

const body = z
  .object({ periodDays: z.number().int().min(1).max(365).optional() })
  .strict();

/** Asks the AI to read the evidence again and rank what to improve next. */
export async function POST(req: NextRequest) {
  const ctx = await requireAdmin();
  if (ctx instanceof NextResponse) return ctx;
  const disabled = requireFeature(ctx, "ai");
  if (disabled) return disabled;
  const parsed = body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  try {
    const { run } = await generateAdvice(
      ctx.db,
      { workspaceId: ctx.workspaceId, userId: ctx.user.id },
      parsed.data,
    );
    const [suggestions, research] = await Promise.all([
      listSuggestions(ctx.db),
      listResearch(ctx.db),
    ]);
    return NextResponse.json({ run, ...suggestions, research });
  } catch (err) {
    if (err instanceof AiNotConfiguredError) {
      return NextResponse.json(
        {
          error: "No AI model is set up yet. Add one under AI models.",
          code: "not_configured",
        },
        { status: 503 },
      );
    }
    if (err instanceof AiBudgetError)
      return NextResponse.json({ error: err.message }, { status: 402 });
    if (err instanceof ProviderKeyError) {
      return NextResponse.json(
        {
          error: "The AI key no longer works. Enter it again under AI models.",
        },
        { status: 502 },
      );
    }
    if (err instanceof ProviderRefusalError)
      return NextResponse.json({ error: err.message }, { status: 502 });
    if (err instanceof ProviderError) {
      return NextResponse.json(
        { error: "The AI provider had a problem. Try again in a moment." },
        { status: 502 },
      );
    }
    if (err instanceof Error && /advice/.test(err.message))
      return NextResponse.json({ error: err.message }, { status: 502 });
    throw err;
  }
}
