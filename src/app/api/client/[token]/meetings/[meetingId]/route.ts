import { NextResponse } from "next/server";
import { clientScope } from "@/lib/comms/http";
import { meetingResponse } from "@/lib/comms/routes";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ token: string; meetingId: string }> }) {
  const { token, meetingId } = await params;
  const s = await clientScope(token);
  if (s instanceof NextResponse) return s;
  return meetingResponse(s, meetingId);
}
