import { NextResponse } from "next/server";
import { z } from "zod";
import { teamScope, commsFailure, commsJson, readBody } from "@/lib/comms/http";
import { meetingResponse } from "@/lib/comms/routes";
import { updateMeeting } from "@/lib/comms/store";
import { meetingChangeSchema } from "@/lib/comms/types";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string; meetingId: string }> };

/** A meeting with its transcript and recordings. */
export async function GET(_req: Request, { params }: Context) {
  const { id, meetingId } = await params;
  const s = await teamScope(id);
  if (s instanceof NextResponse) return s;
  return meetingResponse(s, meetingId);
}

/** Moves, renames, cancels or shares a meeting, or saves notes written by hand. */
export async function PATCH(req: Request, { params }: Context) {
  const { id, meetingId } = await params;
  const s = await teamScope(id, "project:edit");
  if (s instanceof NextResponse) return s;
  const input = meetingChangeSchema.safeParse(await readBody(req));
  if (!input.success || !z.uuid().safeParse(meetingId).success) return commsJson({ error: "Nothing to change" }, 400);
  try {
    return commsJson({ meeting: await updateMeeting(s, meetingId, input.data) });
  } catch (e) {
    return commsFailure(e);
  }
}
