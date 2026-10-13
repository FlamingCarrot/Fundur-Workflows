import { NextResponse } from "next/server";
import { clientScope } from "@/lib/comms/http";
import { roomResponse } from "@/lib/comms/routes";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** An invited client in the call. */
export async function POST(req: Request, { params }: { params: Promise<{ token: string; meetingId: string }> }) {
  const { token, meetingId } = await params;
  const s = await clientScope(token);
  if (s instanceof NextResponse) return s;
  return roomResponse(s, meetingId, req);
}
