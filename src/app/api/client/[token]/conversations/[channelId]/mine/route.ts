import { NextResponse } from "next/server";
import { clientScope } from "@/lib/comms/http";
import { channelMineResponse } from "@/lib/comms/routes";
export const dynamic = "force-dynamic";

/** The client typing in the channel, or muting it for themselves. */
export async function POST(req: Request, { params }: { params: Promise<{ token: string; channelId: string }> }) {
  const { token, channelId } = await params;
  const s = await clientScope(token);
  if (s instanceof NextResponse) return s;
  return channelMineResponse(s, channelId, req);
}
