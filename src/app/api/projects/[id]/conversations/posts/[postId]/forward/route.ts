import { NextResponse } from "next/server";
import { teamScope } from "@/lib/comms/http";
import { forwardResponse } from "@/lib/comms/routes";
export const dynamic = "force-dynamic";

/** Forwards the post into another channel of the project, with a note. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string; postId: string }> }) {
  const { id, postId } = await params;
  const s = await teamScope(id);
  if (s instanceof NextResponse) return s;
  return forwardResponse(s, postId, req);
}
