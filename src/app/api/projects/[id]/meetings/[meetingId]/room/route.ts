import { NextResponse } from "next/server";
import { teamScope } from "@/lib/comms/http";
import { roomResponse } from "@/lib/comms/routes";
export const dynamic = "force-dynamic";
// Leaving last can take notes from the transcript after the response is sent.
export const maxDuration = 300;
type Context = { params: Promise<{ id: string; meetingId: string }> };

/** The call: join, stay in touch, pass handshakes, record, agree, caption, leave or end. */
export async function POST(req: Request, { params }: Context) {
  const { id, meetingId } = await params;
  const s = await teamScope(id);
  if (s instanceof NextResponse) return s;
  return roomResponse(s, meetingId, req);
}
