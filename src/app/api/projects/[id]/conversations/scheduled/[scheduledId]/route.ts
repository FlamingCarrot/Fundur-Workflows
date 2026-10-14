import { NextResponse } from "next/server";
import { teamScope } from "@/lib/comms/http";
import { cancelScheduledResponse } from "@/lib/comms/routes";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string; scheduledId: string }> };

/** Sends a post written for later now. */
export async function POST(_req: Request, { params }: Context) {
  const { id, scheduledId } = await params;
  const s = await teamScope(id);
  if (s instanceof NextResponse) return s;
  return cancelScheduledResponse(s, scheduledId, true);
}

/** Cancels a post written for later. */
export async function DELETE(_req: Request, { params }: Context) {
  const { id, scheduledId } = await params;
  const s = await teamScope(id);
  if (s instanceof NextResponse) return s;
  return cancelScheduledResponse(s, scheduledId, false);
}
