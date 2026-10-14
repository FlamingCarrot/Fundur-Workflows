import { NextResponse } from "next/server";
import { teamScope } from "@/lib/comms/http";
import { scheduledResponse } from "@/lib/comms/routes";
export const dynamic = "force-dynamic";

/** This person's posts in the channel that are waiting to go out. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; channelId: string }> }) {
  const { id, channelId } = await params;
  const s = await teamScope(id);
  if (s instanceof NextResponse) return s;
  return scheduledResponse(s, channelId);
}
