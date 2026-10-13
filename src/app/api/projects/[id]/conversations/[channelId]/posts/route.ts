import { NextResponse } from "next/server";
import { teamScope } from "@/lib/comms/http";
import { addPostResponse, postsResponse } from "@/lib/comms/routes";
export const dynamic = "force-dynamic";
// An "@Assistant" answer is worked out after the post is saved and can take a few minutes.
export const maxDuration = 300;
type Context = { params: Promise<{ id: string; channelId: string }> };

export async function GET(req: Request, { params }: Context) {
  const { id, channelId } = await params;
  const s = await teamScope(id);
  if (s instanceof NextResponse) return s;
  return postsResponse(s, channelId, new URL(req.url));
}

export async function POST(req: Request, { params }: Context) {
  const { id, channelId } = await params;
  const s = await teamScope(id);
  if (s instanceof NextResponse) return s;
  return addPostResponse(s, channelId, req, { isAdmin: s.ctx.user.platformRole === "admin", features: s.ctx.features });
}
