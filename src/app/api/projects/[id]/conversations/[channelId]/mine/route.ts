import { NextResponse } from "next/server";
import { teamScope } from "@/lib/comms/http";
import { channelMineResponse } from "@/lib/comms/routes";
export const dynamic = "force-dynamic";

/** This person typing in the channel, or muting it for themselves. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string; channelId: string }> }) {
  const { id, channelId } = await params;
  const s = await teamScope(id);
  if (s instanceof NextResponse) return s;
  return channelMineResponse(s, channelId, req);
}
