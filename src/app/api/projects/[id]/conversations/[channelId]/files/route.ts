import { NextResponse } from "next/server";
import { teamScope } from "@/lib/comms/http";
import { channelFilesResponse } from "@/lib/comms/routes";
export const dynamic = "force-dynamic";

/** The channel's files in one place: every post and reply that carries one, newest first. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; channelId: string }> }) {
  const { id, channelId } = await params;
  const s = await teamScope(id);
  if (s instanceof NextResponse) return s;
  return channelFilesResponse(s, channelId);
}
