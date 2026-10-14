import { NextResponse } from "next/server";
import { clientScope } from "@/lib/comms/http";
import { channelFilesResponse } from "@/lib/comms/routes";
export const dynamic = "force-dynamic";

/** The files shared in a client channel, newest first. */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string; channelId: string }> }) {
  const { token, channelId } = await params;
  const s = await clientScope(token);
  if (s instanceof NextResponse) return s;
  return channelFilesResponse(s, channelId);
}
