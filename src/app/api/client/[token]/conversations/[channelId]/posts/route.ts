import { NextResponse } from "next/server";
import { clientScope } from "@/lib/comms/http";
import { addPostResponse, postsResponse } from "@/lib/comms/routes";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ token: string; channelId: string }> };

export async function GET(req: Request, { params }: Context) {
  const { token, channelId } = await params;
  const s = await clientScope(token);
  if (s instanceof NextResponse) return s;
  return postsResponse(s, channelId, new URL(req.url));
}

/** A client's post or reply. Clients send text; files they want to share go by the studio's usual route. */
export async function POST(req: Request, { params }: Context) {
  const { token, channelId } = await params;
  const s = await clientScope(token);
  if (s instanceof NextResponse) return s;
  return addPostResponse(s, channelId, req);
}
