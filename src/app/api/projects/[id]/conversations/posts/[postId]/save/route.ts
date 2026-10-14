import { NextResponse } from "next/server";
import { teamScope } from "@/lib/comms/http";
import { saveResponse } from "@/lib/comms/routes";
export const dynamic = "force-dynamic";

/** Saves the post for later, with a reminder if asked, or takes it off the list. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string; postId: string }> }) {
  const { id, postId } = await params;
  const s = await teamScope(id);
  if (s instanceof NextResponse) return s;
  return saveResponse(s, postId, req);
}
