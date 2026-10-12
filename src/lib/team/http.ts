import { NextResponse } from "next/server";
import { AccessError } from "@/lib/workspaces/store";
import { PlanLimitError, limitResponse } from "@/lib/billing/guard";
import type { WorkspaceContext } from "@/lib/server/workspace-context";

export const NO_STORE = { "Cache-Control": "private, no-store" };

export function teamJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

/** Known refusals keep their status; anything else is logged without details and reads as a retry. */
export function teamFailure(e: unknown) {
  if (e instanceof AccessError) return teamJson({ error: e.message }, e.status);
  if (e instanceof PlanLimitError) return limitResponse(e);
  console.error("Team space request failed", e instanceof Error ? e.name : "unknown");
  return teamJson({ error: "That didn't work. Please retry." }, 500);
}

/** Reads a JSON body, or null when it isn't JSON. */
export async function readJson(req: Request): Promise<unknown> {
  return req.json().catch(() => null);
}

/** The name shown beside a comment or message. */
export function authorOf(ctx: WorkspaceContext): { id: string; name: string } {
  return { id: ctx.user.id, name: ctx.user.name || ctx.user.email || "Teammate" };
}
