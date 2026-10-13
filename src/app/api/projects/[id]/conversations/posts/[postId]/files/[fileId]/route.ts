import { NextResponse } from "next/server";
import { teamScope } from "@/lib/comms/http";
import { attachmentResponse } from "@/lib/comms/routes";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string; postId: string; fileId: string }> };

/** A file shared in a post, for someone who can see the post. */
export async function GET(req: Request, { params }: Context) {
  const { id, postId, fileId } = await params;
  const s = await teamScope(id);
  if (s instanceof NextResponse) return s;
  return attachmentResponse(s, postId, fileId, new URL(req.url));
}
