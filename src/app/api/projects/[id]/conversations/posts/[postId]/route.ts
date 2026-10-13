import { NextResponse } from "next/server";
import { teamScope } from "@/lib/comms/http";
import { deletePostResponse, editPostResponse, threadResponse } from "@/lib/comms/routes";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string; postId: string }> };

/** A post and its replies. */
export async function GET(_req: Request, { params }: Context) {
  const { id, postId } = await params;
  const s = await teamScope(id);
  if (s instanceof NextResponse) return s;
  return threadResponse(s, postId);
}

export async function PATCH(req: Request, { params }: Context) {
  const { id, postId } = await params;
  const s = await teamScope(id);
  if (s instanceof NextResponse) return s;
  return editPostResponse(s, postId, req);
}

export async function DELETE(_req: Request, { params }: Context) {
  const { id, postId } = await params;
  const s = await teamScope(id);
  if (s instanceof NextResponse) return s;
  return deletePostResponse(s, postId);
}
